import { useCallback, useEffect, useRef, useState } from 'react'
import Celebration from '../../components/Celebration'
import { createRoom, fetchRoom, forfeitRoom, joinRoom, sendMove, wakeBackend } from '../../lib/roomsApi'
import { useProfile } from '../../lib/useProfile'
import {
  BLACK,
  EMPTY,
  applyMove,
  cellToIndex,
  colorForRole,
  countDiscs,
  flipsForMove,
  indexToCell,
  legalMoves,
  nextTurn,
  replayMoves,
} from './logic'

const POLL_MS = 1500

export default function ReversiOnline({ onExit }) {
  const { profile } = useProfile()
  const [room, setRoom] = useState(null)
  const [codeInput, setCodeInput] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [copied, setCopied] = useState(false)

  // Kept in a ref as well so the poll loop can compare versions without
  // being re-created (and restarting its timer) on every state change.
  const versionRef = useRef(0)

  // Wake the free instance while the player is still reading the lobby, so
  // the 30-60s cold start overlaps with them rather than blocking a click.
  useEffect(() => {
    wakeBackend()
  }, [])

  const refresh = useCallback(async () => {
    if (!room?.code || !profile) return
    try {
      const next = await fetchRoom(room.code, profile.id)
      if (next.version !== versionRef.current) {
        versionRef.current = next.version
        setRoom(next)
      }
    } catch (err) {
      setError(err.message)
    }
  }, [room?.code, profile])

  // Poll while a room is open and the game is not over.
  useEffect(() => {
    if (!room?.code || room.status === 'FINISHED') return undefined
    const timer = setInterval(refresh, POLL_MS)
    return () => clearInterval(timer)
  }, [room?.code, room?.status, refresh])

  function adopt(next) {
    versionRef.current = next.version
    setRoom(next)
    setError('')
  }

  async function handleCreate() {
    setBusy('create')
    setError('')
    try {
      adopt(await createRoom({ gameType: 'reversi', playerId: profile.id, playerName: profile.name }))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy('')
    }
  }

  async function handleJoin(event) {
    event.preventDefault()
    const code = codeInput.trim().toUpperCase()
    if (code.length < 4) {
      setError('Room codes are 4 characters.')
      return
    }
    setBusy('join')
    setError('')
    try {
      adopt(await joinRoom(code, { playerId: profile.id, playerName: profile.name }))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy('')
    }
  }

  async function handleLeave() {
    if (room?.code) {
      try {
        await forfeitRoom(room.code, profile.id)
      } catch {
        /* leaving is best-effort; the room expires on its own anyway */
      }
    }
    setRoom(null)
    versionRef.current = 0
    setError('')
  }

  function copyCode() {
    navigator.clipboard?.writeText(room.code).then(
      () => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1600)
      },
      () => setError('Could not copy - read the code out instead.')
    )
  }

  /* ---- lobby ---- */

  if (!room) {
    return (
      <div className="online-lobby">
        <p className="online-intro">
          Play a friend on another device. Create a room and share the code, or
          type the code they sent you.
        </p>

        <button className="btn btn-primary online-create" onClick={handleCreate} disabled={busy === 'create'}>
          {busy === 'create' ? 'Creating room…' : 'Create a room'}
        </button>

        <div className="online-divider"><span>or</span></div>

        <form className="online-join" onSubmit={handleJoin}>
          <input
            className="online-code-input"
            value={codeInput}
            onChange={(event) => setCodeInput(event.target.value.toUpperCase())}
            placeholder="CODE"
            maxLength={4}
            aria-label="Room code"
            autoComplete="off"
          />
          <button className="btn btn-ghost" type="submit" disabled={busy === 'join'}>
            {busy === 'join' ? 'Joining…' : 'Join'}
          </button>
        </form>

        {error && <p className="online-error">{error}</p>}

        <p className="online-note">
          The server sleeps when nobody is playing, so the first room of the day
          can take up to a minute to wake up.
        </p>

        <button className="mode-btn online-back" onClick={onExit}>← Back to offline play</button>
      </div>
    )
  }

  /* ---- in a room ---- */

  const myColor = colorForRole(room.yourRole)
  const { board, player: turnColor, over: rulesOver } = replayMoves(room.moves)
  const { black, white } = countDiscs(board)
  const myDiscs = myColor === BLACK ? black : white
  const theirDiscs = myColor === BLACK ? white : black
  const opponentName = room.yourRole === 'host' ? room.guestName : room.hostName

  const waiting = room.status === 'WAITING'
  const finished = room.status === 'FINISHED' || rulesOver
  const myTurn = room.yourTurn && !waiting && !finished
  const moves = myTurn ? legalMoves(board, myColor) : []
  const legalSet = new Set(moves.map((m) => `${m.row},${m.col}`))

  async function play(row, col) {
    if (!myTurn) return
    const flips = flipsForMove(board, row, col, myColor)
    if (flips.length === 0) return

    // Work out what happens after this move so the server can be told whose
    // turn is next. Only the client knows Reversi's pass rule, which is why
    // the server takes this on trust.
    const nextBoard = applyMove(board, row, col, myColor, flips)
    const turn = nextTurn(nextBoard, myColor)
    // The server defaults to "the other player" when nextPlayerId is null, so
    // the only case worth naming explicitly is a pass back to me.
    const nextPlayerId = turn.player === myColor ? profile.id : null

    const optimisticCode = room.code
    try {
      const updated = await sendMove(optimisticCode, {
        playerId: profile.id,
        index: cellToIndex(row, col),
        nextPlayerId,
        gameOver: turn.over,
        resultNote: turn.over ? 'Board complete' : null,
      })
      adopt(updated)
    } catch (err) {
      setError(err.message)
      refresh()
    }
  }

  const outcome = myDiscs > theirDiscs ? 'win' : myDiscs < theirDiscs ? 'lose' : 'draw'
  const RESULT = {
    win: { emoji: '🏆', title: 'You win!', tier: 'tier-gold' },
    lose: { emoji: '🫡', title: `${opponentName || 'Your friend'} wins`, tier: 'tier-silver' },
    draw: { emoji: '🤝', title: "It's a draw", tier: 'tier-participant' },
  }[outcome]

  let statusLine
  if (waiting) statusLine = 'Waiting for your friend to join…'
  else if (myTurn) statusLine = 'Your move'
  else statusLine = `Waiting for ${opponentName || 'your friend'}…`

  return (
    <div className="online-room">
      <div className="online-bar">
        <div className="online-code-block">
          <span className="online-code-label">Room code</span>
          <button className="online-code" onClick={copyCode} title="Copy code">
            {room.code}
          </button>
          {copied && <span className="online-copied">Copied</span>}
        </div>
        <button className="mode-btn" onClick={handleLeave}>Leave</button>
      </div>

      {waiting && (
        <p className="online-share">
          Send <strong>{room.code}</strong> to your friend. They pick Reversi →
          Online → Join.
        </p>
      )}

      <div className="reversi-status">
        <span className={`score-chip ${myTurn ? 'is-turn' : ''}`}>
          <span className={`disc ${myColor === BLACK ? 'disc-black' : 'disc-white'} disc-chip`} aria-hidden="true" />
          <strong>{myDiscs}</strong> You
        </span>
        <span className="score-chip">
          <span className={`disc ${myColor === BLACK ? 'disc-white' : 'disc-black'} disc-chip`} aria-hidden="true" />
          <strong>{theirDiscs}</strong> {opponentName || 'Friend'}
        </span>
      </div>

      {finished ? (
        <>
          <Celebration outcome={outcome} />
          <div className={`reward-banner ${RESULT.tier}`} aria-live="polite">
            <div className="reward-emoji">{RESULT.emoji}</div>
            <h2>{RESULT.title}</h2>
            <p className="reward-secret">
              Final score {myDiscs} &ndash; {theirDiscs}
            </p>
            <button className="btn btn-primary" onClick={handleLeave}>
              Back to lobby
            </button>
          </div>
        </>
      ) : (
        <p className="reversi-turn" aria-live="polite">{statusLine}</p>
      )}
      {error && <p className="online-error">{error}</p>}

      <div className="reversi-board" role="grid" aria-label="Reversi board">
        {board.map((rowCells, row) =>
          rowCells.map((cell, col) => {
            const isLegal = legalSet.has(`${row},${col}`)
            const lastMove = room.moves[room.moves.length - 1]
            const isLast = lastMove && lastMove.index === cellToIndex(row, col)
            return (
              <button
                key={`${row}-${col}`}
                type="button"
                role="gridcell"
                className={`reversi-cell ${isLegal ? 'is-legal' : ''} ${isLast ? 'is-last' : ''}`}
                onClick={() => play(row, col)}
                disabled={!isLegal}
                aria-label={`row ${row + 1} column ${col + 1}`}
              >
                {cell !== EMPTY && (
                  <span className={`disc ${cell === BLACK ? 'disc-black' : 'disc-white'}`} />
                )}
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}
