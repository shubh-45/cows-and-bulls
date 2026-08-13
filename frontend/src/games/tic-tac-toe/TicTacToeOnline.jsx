import { useCallback, useEffect, useRef, useState } from 'react'
import Celebration from '../../components/Celebration'
import { createRoom, fetchRoom, forfeitRoom, joinRoom, sendMove, wakeBackend } from '../../lib/roomsApi'
import { useProfile } from '../../lib/useProfile'
import Board, { Badge } from './Board'
import { X, markForRole, replayMoves } from './logic'

const POLL_MS = 1500

// Reuses the rooms API exactly as Reversi does - the server was written to be
// game-agnostic (it stores an ordered move list and already knows tic-tac-toe
// is a 3x3 board), so this mode needed no backend change at all.
export default function TicTacToeOnline({ onExit }) {
  const { profile } = useProfile()
  const [room, setRoom] = useState(null)
  const [codeInput, setCodeInput] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [copied, setCopied] = useState(false)

  // Held in a ref too, so the poll loop can skip unchanged responses without
  // being re-created (and restarting its timer) on every render.
  const versionRef = useRef(0)

  // Wake the sleeping free instance while the player reads the lobby, so the
  // 30-60s cold start overlaps with them instead of stalling their first click.
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
      adopt(await createRoom({ gameType: 'tic-tac-toe', playerId: profile.id, playerName: profile.name }))
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
        /* best effort - the room expires on its own anyway */
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

  const myMark = markForRole(room.yourRole)
  const { board, winner, over } = replayMoves(room.moves)
  const opponentName = room.yourRole === 'host' ? room.guestName : room.hostName
  const waiting = room.status === 'WAITING'
  const finished = room.status === 'FINISHED' || over
  const myTurn = room.yourTurn && !waiting && !finished
  const lastMove = room.moves.length ? room.moves[room.moves.length - 1].index : null

  async function play(index) {
    if (!myTurn) return

    // Replay the move list with this move appended to see whether it ends the
    // game. The server deliberately holds no copy of the rules, so it is told
    // the outcome - but it still independently rejects anything it can check
    // without them: a move out of turn, off the board, or onto a taken square.
    const projected = replayMoves([...room.moves, { index, role: room.yourRole }])

    try {
      const updated = await sendMove(room.code, {
        playerId: profile.id,
        index,
        // Tic-Tac-Toe has no pass rule, so the turn always goes to the other
        // player - which is exactly what the server assumes when this is null.
        nextPlayerId: null,
        gameOver: projected.over,
        resultNote: projected.winner
          ? `${projected.winner.player === X ? 'X' : 'O'} wins`
          : 'Board full',
      })
      adopt(updated)
    } catch (err) {
      setError(err.message)
      refresh()
    }
  }

  let result = null
  if (finished) {
    if (!winner) {
      result = { outcome: 'draw', emoji: '🤝', title: "It's a draw", tier: 'tier-participant' }
    } else if (winner.player === myMark) {
      result = { outcome: 'win', emoji: '🏆', title: 'You win!', tier: 'tier-gold' }
    } else {
      result = {
        outcome: 'lose',
        emoji: '🫡',
        title: `${opponentName || 'Your friend'} wins`,
        tier: 'tier-silver',
      }
    }
  }

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
          Send <strong>{room.code}</strong> to your friend. They pick Tic-Tac-Toe
          → Online → Join.
        </p>
      )}

      <div className="ttt-status">
        <span className={`ttt-turn ${myMark === X ? 'is-x' : 'is-o'}`}>
          <Badge player={myMark} />
          You are <strong>{myMark === X ? 'X' : 'O'}</strong>
        </span>
        {!finished && (
          <span className="ttt-turn">
            {waiting
              ? 'Waiting for your friend…'
              : myTurn
              ? 'Your move'
              : `Waiting for ${opponentName || 'your friend'}…`}
          </span>
        )}
      </div>

      {error && <p className="online-error">{error}</p>}

      {result && (
        <>
          <Celebration outcome={result.outcome} />
          <div className={`reward-banner ${result.tier}`} aria-live="polite">
            <div className="reward-emoji">{result.emoji}</div>
            <h2>{result.title}</h2>
            <button className="btn btn-primary" onClick={handleLeave}>Back to lobby</button>
          </div>
        </>
      )}

      <Board
        board={board}
        winner={winner}
        onPlay={play}
        canPlay={() => myTurn}
        lastMove={lastMove}
      />
    </div>
  )
}
