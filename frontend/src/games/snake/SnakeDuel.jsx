import { useCallback, useEffect, useRef, useState } from 'react'
import { MatchResult, RoomHeader, RoomLobby } from '../../components/RoomShell'
import { createPeer } from '../../lib/peer'
import { reportResult } from '../../lib/roomsApi'
import { useRoom } from '../../lib/useRoom'
import SnakeBoard, { steerFrom } from './Board'
import { DEATH, seedFromString } from './engine'
import { INPUT_DELAY, TICK_MS, createLockstep } from './lockstep'
import './Snake.css'

const COUNTDOWN_MS = 3000
/** Long enough to ride out a hiccup, short enough not to look frozen. */
const STALL_WARNING_MS = 1200

const DEATH_TEXT = {
  [DEATH.WALL]: 'hit the wall',
  [DEATH.SELF]: 'ran into themselves',
  [DEATH.OPPONENT]: 'ran into the other snake',
  [DEATH.HEAD_ON]: 'crashed head-on',
}

export default function SnakeDuel({ onExit }) {
  const { room, playerId, error, busy, copied, create, join, rematch, leave, copyCode } =
    useRoom('snake')

  const [connection, setConnection] = useState('idle')
  const [game, setGame] = useState(null)
  const [countdown, setCountdown] = useState(null)
  const [stalled, setStalled] = useState(false)
  const [reported, setReported] = useState(false)
  // Bumping this tears the peer down and negotiates again, which is the only
  // useful thing to offer someone whose connection didn't come up.
  const [attempt, setAttempt] = useState(0)
  // Mirrors the direction just accepted so the head can face it immediately,
  // exactly as the solo game does. Without it the input delay reads as lag.
  const [facing, setFacing] = useState(null)

  const peerRef = useRef(null)
  const lockstepRef = useRef(null)
  const steerRef = useRef(null)

  const isHost = room?.yourRole === 'host'
  const matchNumber = room?.matchNumber ?? 1
  // Both sides derive the seed from the room code and match number, so the
  // food sequence matches without anyone having to send it.
  const seed = room ? seedFromString(`${room.code}:${matchNumber}`) : 0

  /* ---- connection ---- */

  useEffect(() => {
    if (!room?.opponentPresent || !playerId || peerRef.current) return undefined

    const peer = createPeer({
      code: room.code,
      playerId,
      isHost,
      onStatus: setConnection,
      onMessage: (msg) => {
        if (msg?.k === 'i') lockstepRef.current?.receive(msg.t, msg.r, msg.d)
      },
    })
    peerRef.current = peer
    return () => {
      peer.close()
      peerRef.current = null
    }
  }, [room?.opponentPresent, room?.code, playerId, isHost, attempt])

  /* ---- match lifecycle ---- */

  // A new match (first one, or a rematch) rebuilds the simulation from the
  // shared seed and counts both players in.
  useEffect(() => {
    if (connection !== 'connected' || !room) return undefined
    if (room.status !== 'PLAYING') return undefined

    lockstepRef.current = createLockstep({
      seed,
      localRole: room.yourRole,
      onState: setGame,
    })
    setGame(lockstepRef.current.state)
    setReported(false)
    setStalled(false)

    const startAt = Date.now() + COUNTDOWN_MS
    setCountdown(Math.ceil(COUNTDOWN_MS / 1000))
    const timer = setInterval(() => {
      const left = Math.ceil((startAt - Date.now()) / 1000)
      setCountdown(left > 0 ? left : null)
      if (left <= 0) clearInterval(timer)
    }, 200)

    return () => clearInterval(timer)
  }, [connection, room?.status, matchNumber, seed, room?.yourRole])

  /* ---- the tick loop ---- */

  useEffect(() => {
    const lockstep = lockstepRef.current
    const peer = peerRef.current
    if (!lockstep || !peer || countdown !== null) return undefined
    if (connection !== 'connected' || lockstep.state.status === 'over') return undefined

    let frame
    let last = performance.now()
    let accumulator = 0

    const loop = (now) => {
      accumulator = Math.min(accumulator + (now - last), 500)
      last = now

      // One commit per tick of real time. Advancing is separate and only
      // happens when the peer's input has actually arrived.
      while (accumulator >= TICK_MS) {
        accumulator -= TICK_MS
        for (const message of lockstep.commit()) {
          peer.send({ k: 'i', ...message })
        }
      }
      lockstep.advance()
      setStalled(lockstep.stalledFor() > STALL_WARNING_MS)

      frame = requestAnimationFrame(loop)
    }
    frame = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(frame)
  }, [countdown, connection, game?.status])

  /* ---- input ---- */

  const steer = useCallback((steerOrDir) => {
    const lockstep = lockstepRef.current
    if (!lockstep || lockstep.state.status === 'over') return
    const seat = lockstep.localSeat
    const current = steerRef.current ?? lockstep.state.snakes[seat].dir
    const next = steerFrom(current, steerOrDir)
    if (next !== current) {
      steerRef.current = next
      setFacing(next)
      lockstep.steer(next)
    }
  }, [])

  // Only listen while a match is actually running.
  //
  // This handler preventDefaults W/A/S/D, and it used to be attached the whole
  // time the duel screen was mounted - including in the lobby, where it ate
  // exactly those letters out of the room-code field. Room codes are drawn
  // from an alphabet containing A, D, S and W, so any code with one of them in
  // it was impossible to type.
  const canSteer = Boolean(game) && game.status !== 'over' && countdown === null
  useEffect(() => {
    if (!canSteer) return undefined

    const keys = {
      ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
      w: 'up', s: 'down', a: 'left', d: 'right', W: 'up', S: 'down', A: 'left', D: 'right',
    }
    function onKeyDown(event) {
      // Belt and braces: never steal a keystroke aimed at a text field, so
      // adding any future input to this screen can't resurrect the same bug.
      const tag = event.target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || event.target?.isContentEditable) return

      const dir = keys[event.key]
      if (!dir) return
      event.preventDefault()
      steer(dir)
    }
    window.addEventListener('keydown', onKeyDown, { passive: false })
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [steer, canSteer])

  // Whichever seat this player has, the simulation's own direction wins once
  // the tick catches up with the input.
  useEffect(() => {
    if (game && lockstepRef.current) {
      const seat = lockstepRef.current.localSeat
      if (game.snakes[seat]?.dir === steerRef.current) {
        steerRef.current = null
        setFacing(null)
      }
    }
  }, [game])

  /* ---- reporting the result ---- */

  useEffect(() => {
    if (!game || game.status !== 'over' || reported || !room) return
    const lockstep = lockstepRef.current
    if (!lockstep) return

    const [hostSnake, guestSnake] = game.snakes
    let winnerRole = 'draw'
    if (hostSnake.alive !== guestSnake.alive) {
      winnerRole = hostSnake.alive ? 'host' : 'guest'
    } else if (hostSnake.score !== guestSnake.score) {
      winnerRole = hostSnake.score > guestSnake.score ? 'host' : 'guest'
    }

    setReported(true)
    // Safe for both players to send: the server ignores a match that is
    // already finished, so it cannot be counted twice.
    reportResult(room.code, playerId, winnerRole, 'Snake duel').catch(() => {})
  }, [game?.status, reported, room?.code, playerId])

  /* ---- render ---- */

  if (!room) {
    return <RoomLobby onCreate={create} onJoin={join} busy={busy} error={error} onExit={onExit} />
  }

  const waiting = room.status === 'WAITING'
  const abandoned = room.status === 'ABANDONED'
  const seat = lockstepRef.current?.localSeat ?? 0
  const mySnake = game?.snakes[seat]
  const theirSnake = game?.snakes[seat === 0 ? 1 : 0]
  const over = game?.status === 'over'

  let result = null
  if (over && !abandoned) {
    const iWon = mySnake.alive !== theirSnake.alive
      ? mySnake.alive
      : mySnake.score > theirSnake.score
    const drawn = mySnake.alive === theirSnake.alive && mySnake.score === theirSnake.score
    const loser = mySnake.alive ? theirSnake : mySnake
    const who = loser === mySnake ? 'You' : room.opponentName || 'They'
    result = drawn
      ? { outcome: 'draw', emoji: '🤝', title: "It's a draw", tier: 'tier-participant',
          detail: `${mySnake.score} – ${theirSnake.score}` }
      : iWon
      ? { outcome: 'win', emoji: '🏆', title: 'You win!', tier: 'tier-gold',
          detail: `${mySnake.score} – ${theirSnake.score} · ${who} ${DEATH_TEXT[loser.causeOfDeath] ?? 'crashed'}` }
      : { outcome: 'lose', emoji: '🫡', title: `${room.opponentName || 'Your friend'} wins`,
          tier: 'tier-silver',
          detail: `${mySnake.score} – ${theirSnake.score} · ${who} ${DEATH_TEXT[loser.causeOfDeath] ?? 'crashed'}` }
  }

  return (
    <div className="online-room">
      <RoomHeader room={room} copied={copied} onCopy={copyCode} onLeave={leave} />

      {waiting && (
        <p className="online-share">
          Send <strong>{room.code}</strong> to your friend. They pick Snake →
          Duel → Join.
        </p>
      )}

      {room.opponentPresent && connection !== 'connected' && !abandoned && (
        <div className={connection === 'failed' ? 'online-error' : 'online-share'}>
          {connection === 'failed' ? (
            <>
              <p style={{ margin: 0 }}>
                Couldn't open a direct connection. Both of you need to be here at
                the same time, and some networks block it &mdash; the same WiFi
                works best.
              </p>
              <button
                className="btn btn-primary"
                style={{ marginTop: 12 }}
                onClick={() => setAttempt((n) => n + 1)}
              >
                Try again
              </button>
            </>
          ) : (
            <p style={{ margin: 0 }}>Connecting directly to your friend…</p>
          )}
        </div>
      )}

      {error && <p className="online-error">{error}</p>}

      {game && (
        <div className="snake-status">
          <span className="snake-score">
            <span className="snake-score-label">You</span>
            <strong>{mySnake?.score ?? 0}</strong>
          </span>
          <span className="snake-score">
            <span className="snake-score-label">{room.opponentName || 'Friend'}</span>
            <strong>{theirSnake?.score ?? 0}</strong>
          </span>
        </div>
      )}

      {(result || abandoned) && (
        <MatchResult room={room} result={result} onRematch={rematch} onLeave={leave} busy={busy} />
      )}

      {game && (
        <div className="snake-stage">
          <SnakeBoard
            state={game}
            onSteer={over || countdown !== null ? null : steer}
            facing={facing}
            palette={seat === 0 ? ['p1', 'p2'] : ['p2', 'p1']}
          />

          {countdown !== null && (
            <div className="snake-overlay">
              <p className="snake-countdown">{countdown}</p>
              <p className="snake-overlay-copy">
                You are the <strong>{seat === 0 ? 'green' : 'blue'}</strong> snake
              </p>
            </div>
          )}

          {stalled && !over && countdown === null && (
            <div className="snake-overlay is-stalled">
              <p className="snake-overlay-copy">Waiting for {room.opponentName || 'your friend'}…</p>
            </div>
          )}
        </div>
      )}

      {game && !over && countdown === null && <DuelPad onSteer={steer} />}
    </div>
  )
}

function DuelPad({ onSteer }) {
  return (
    <div className="snake-pad is-duel">
      <button className="pad-btn pad-up" onClick={() => onSteer('up')} aria-label="Up">▲</button>
      <button className="pad-btn pad-left" onClick={() => onSteer('left')} aria-label="Left">◀</button>
      <button className="pad-btn pad-right" onClick={() => onSteer('right')} aria-label="Right">▶</button>
      <button className="pad-btn pad-down" onClick={() => onSteer('down')} aria-label="Down">▼</button>
    </div>
  )
}
