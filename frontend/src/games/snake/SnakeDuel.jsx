import { useCallback, useEffect, useRef, useState } from 'react'
import { MatchResult, RoomHeader, RoomLobby } from '../../components/RoomShell'
import { createDuelLink } from '../../lib/duelSocket'
import { reportResult } from '../../lib/roomsApi'
import { useRoom } from '../../lib/useRoom'
import SnakeBoard, { steerFrom } from './Board'
import { DEATH, seedFromString } from './engine'
import { PROTOCOL_VERSION, TICK_MS, createDuel } from './authority'
import './Snake.css'

const COUNTDOWN_MS = 3000
/** Long enough to ride out a hiccup, short enough not to look frozen. */
const STALL_WARNING_MS = 1200

/**
 * A dropped socket is recoverable and reconnects on its own, so none of these
 * are dead ends except 'rejected'. Saying which one it is matters: "waking"
 * asks for patience, "reconnecting" says the match is still there.
 */
const CONNECTION_COPY = {
  connecting: 'Connecting…',
  waking:
    'Waking the server — it sleeps after 15 minutes idle, so the first connection can take up to a minute.',
  waiting: 'Waiting for your friend to open the duel…',
  reconnecting: 'Connection dropped — reconnecting, the match is still here…',
  rejected: 'This room no longer has a seat for you. Leave and start a new one.',
  closed: 'Disconnected.',
}

/**
 * Turned on by putting "debug" anywhere in the URL, e.g.
 *   https://shubh-arcade.netlify.app/?debug#/games/snake
 * Phone-friendly on purpose: this has to be switchable on the devices where the
 * problem actually happens, without a console.
 */
const DEBUG = typeof window !== 'undefined' && window.location.href.includes('debug')

/** Above this a relayed hop starts to be felt on the opponent's snake. */
const SLOW_PING_MS = 300

const DEATH_TEXT = {
  [DEATH.WALL]: 'hit the wall',
  [DEATH.SELF]: 'ran into themselves',
  [DEATH.OPPONENT]: 'ran into the other snake',
  [DEATH.HEAD_ON]: 'crashed head-on',
}

export default function SnakeDuel({ onExit }) {
  const { room, playerId, error, busy, copied, create, join, rematch, leave, copyCode, refresh } =
    useRoom('snake')

  const [connection, setConnection] = useState('connecting')
  const [latency, setLatency] = useState(null)
  // Set when the opponent is running a build that would simulate differently.
  const [versionGap, setVersionGap] = useState(false)
  const [game, setGame] = useState(null)
  const [countdown, setCountdown] = useState(null)
  const [stalled, setStalled] = useState(false)
  // Where the board is between cells: the next tick's state and how far through
  // the current tick we are. Updated every animation frame, which is what turns
  // a cell-by-cell jump into movement.
  const [glide, setGlide] = useState({ next: null, progress: 0 })
  const [diag, setDiag] = useState(null)
  const [reported, setReported] = useState(false)
  // Mirrors the direction just accepted so the head can face it immediately,
  // exactly as the solo game does. Without it the input delay reads as lag.
  const [facing, setFacing] = useState(null)

  const linkRef = useRef(null)
  const duelRef = useRef(null)
  const steerRef = useRef(null)
  // Which match the current simulation was built for. Guards against a
  // connection blip rebuilding the match mid-play and resetting the board.
  const startedRef = useRef(null)
  const countdownTimerRef = useRef(null)

  const matchNumber = room?.matchNumber ?? 1
  // Read inside the socket callback, which is created once and would otherwise
  // capture the match number it was built with.
  const matchRef = useRef(matchNumber)
  matchRef.current = matchNumber
  // Both sides derive the seed from the room code and match number, so the
  // food sequence matches without anyone having to send it.
  const seed = room ? seedFromString(`${room.code}:${matchNumber}`) : 0

  /* ---- connection ---- */

  // Opened as soon as this player is in a room, rather than waiting for the
  // opponent to show up. The relay parks a lone player as 'waiting', so the
  // socket - and any cold-start wait - is already dealt with by the time the
  // friend arrives, and the match begins the instant the server pairs them.
  useEffect(() => {
    if (!room?.code || !playerId) return undefined

    const link = createDuelLink({
      code: room.code,
      playerId,
      onStatus: (status, detail) => {
        setConnection(status)
        if (detail?.rtt != null) setLatency(detail.rtt)
      },
      onMessage: (msg) => {
        if (!msg?.k) return
        // An opponent on an older build speaks a different protocol entirely.
        // Saying so beats two people staring at boards that quietly disagree.
        if (msg.v !== PROTOCOL_VERSION) {
          setVersionGap(true)
          return
        }
        // A snapshot left over from the previous match would drag the board
        // backwards into a game that is already finished.
        if (msg.m !== matchRef.current) return
        duelRef.current?.receive(msg)
      },
    })
    linkRef.current = link
    return () => {
      link.close()
      linkRef.current = null
    }
  }, [room?.code, playerId])

  // Whenever the pair re-forms, the referee restates where the match is. A
  // guest that was disconnected when the match ended would otherwise never be
  // told: snapshots ride on ticks, and a finished match has none left.
  useEffect(() => {
    if (connection !== 'connected') return
    duelRef.current?.resync()
    // The socket knows both players are here the instant they are; the room
    // only says so on the next poll, up to 1.5s later. The match begins on
    // room status, so the host used to start counting down as much as a second
    // and a half after the guest - who finished counting, saw a still board and
    // was told their friend had stopped responding. Asking the room now
    // collapses that to one round trip.
    refresh()
  }, [connection, refresh])

  /* ---- match lifecycle ---- */

  // A new match (first one, or a rematch) rebuilds the simulation from the
  // shared seed and counts both players in.
  //
  // Keyed on the match, not on the connection. A socket that drops and comes
  // back re-fires 'connected', and rebuilding on that would wipe a match in
  // progress and hand both players a fresh board halfway through.
  useEffect(() => {
    if (connection !== 'connected' || !room || room.status !== 'PLAYING') return

    const key = `${room.code}:${matchNumber}`
    if (startedRef.current === key) return
    startedRef.current = key

    duelRef.current = createDuel({
      seed,
      role: room.yourRole,
      onState: setGame,
      // The match number rides on every message so a rematch cannot be
      // confused with the match before it.
      send: (msg) => linkRef.current?.send({ ...msg, m: matchRef.current }),
    })
    setGame(duelRef.current.state)
    setReported(false)
    setStalled(false)
    setVersionGap(false)
    steerRef.current = null
    setFacing(null)

    // The two countdowns need not line up. The referee starts simulating when
    // its own reaches zero and the guest simply picks up the snapshots, so the
    // clock is there for the players, not for correctness.
    const startAt = Date.now() + COUNTDOWN_MS
    setCountdown(Math.ceil(COUNTDOWN_MS / 1000))
    clearInterval(countdownTimerRef.current)
    countdownTimerRef.current = setInterval(() => {
      const left = Math.ceil((startAt - Date.now()) / 1000)
      setCountdown(left > 0 ? left : null)
      if (left <= 0) clearInterval(countdownTimerRef.current)
    }, 200)
  }, [connection, room?.status, room?.code, matchNumber, seed, room?.yourRole])

  useEffect(() => () => clearInterval(countdownTimerRef.current), [])

  /* ---- the tick loop ---- */

  useEffect(() => {
    const duel = duelRef.current
    if (!duel || countdown !== null) return undefined
    if (connection !== 'connected' || duel.state.status === 'over') return undefined

    let frame
    let last = performance.now()
    let accumulator = 0
    // Diagnostics: frames drawn, and frames where the glide sat pinned at 0 or
    // 1 - which is exactly what a player sees as the board being stuck.
    let frames = 0
    let pinned = 0
    let sampledAt = last

    const loop = (now) => {
      accumulator = Math.min(accumulator + (now - last), 500)
      last = now

      // At most ONE tick per animation frame.
      //
      // Draining the whole backlog in a single frame was a burst generator: a
      // phone's rAF stalls all the time - scrolling, browser chrome, low power
      // - and a 450ms stall made this fire twice back to back, so the referee
      // emitted two snapshots at once and then went quiet. Its own screen was
      // fine, because it draws from its own clock; the guest saw a lurch and
      // then a freeze. Catching up one tick per frame clears the same backlog
      // in a few 16ms frames instead, which nobody can see.
      if (accumulator >= TICK_MS) {
        accumulator -= TICK_MS
        duel.tick()
      }

      const progress = duel.progress()
      setGlide({ next: duel.peekNext(), progress })

      if (DEBUG) {
        frames += 1
        if (progress <= 0 || progress >= 1) pinned += 1
        if (now - sampledAt >= 500) {
          const seconds = (now - sampledAt) / 1000
          setDiag({
            fps: Math.round(frames / seconds),
            pinned: Math.round((pinned / Math.max(frames, 1)) * 100),
            beat: duel.stats(),
          })
          frames = 0
          pinned = 0
          sampledAt = now
        }
      }
      // Only the guest can be left waiting, and only if the referee itself has
      // gone quiet - never because of a single late input.
      setStalled(duel.silentFor() > STALL_WARNING_MS)

      frame = requestAnimationFrame(loop)
    }
    frame = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(frame)
  }, [countdown, connection, game?.status])

  /* ---- input ---- */

  const steer = useCallback((steerOrDir) => {
    const duel = duelRef.current
    if (!duel || duel.state.status === 'over') return
    const seat = duel.localSeat
    const current = steerRef.current ?? duel.state.snakes[seat].dir
    const next = steerFrom(current, steerOrDir)
    if (next !== current) {
      steerRef.current = next
      setFacing(next)
      duel.steer(next)
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
    if (game && duelRef.current) {
      const seat = duelRef.current.localSeat
      if (game.snakes[seat]?.dir === steerRef.current) {
        steerRef.current = null
        setFacing(null)
      }
    }
  }, [game])

  /* ---- reporting the result ---- */

  useEffect(() => {
    if (!game || game.status !== 'over' || reported || !room) return
    const duel = duelRef.current
    if (!duel) return

    const [hostSnake, guestSnake] = game.snakes
    let winnerRole = 'draw'
    if (hostSnake.alive !== guestSnake.alive) {
      winnerRole = hostSnake.alive ? 'host' : 'guest'
    } else if (hostSnake.score !== guestSnake.score) {
      winnerRole = hostSnake.score > guestSnake.score ? 'host' : 'guest'
    }

    setReported(true)
    // Only the referee reports. It is the one that decided the outcome, and it
    // is the only side that cannot still be corrected: the guest's board is a
    // prediction until the snapshot confirming it lands, so a guest reporting
    // first could record a result its own referee was about to revise.
    if (!duel.isHost) return
    reportResult(room.code, playerId, winnerRole, 'Snake duel').catch(() => {})
  }, [game?.status, reported, room?.code, playerId])

  /* ---- render ---- */

  if (!room) {
    return <RoomLobby onCreate={create} onJoin={join} busy={busy} error={error} onExit={onExit} />
  }

  const waiting = room.status === 'WAITING'
  const abandoned = room.status === 'ABANDONED'
  const seat = duelRef.current?.localSeat ?? 0
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

      {/* Before the board exists, connection state is the whole story. Once a
          match is running it moves to an overlay instead, so a blip does not
          shove the board down the page. */}
      {!game && !abandoned && connection !== 'connected' &&
        !(waiting && connection === 'waiting') && (
        <div className={connection === 'rejected' ? 'online-error' : 'online-share'}>
          <p style={{ margin: 0 }}>{CONNECTION_COPY[connection] ?? 'Connecting…'}</p>
        </div>
      )}

      {versionGap && (
        <p className="online-error">
          You and {room.opponentName || 'your friend'} are on different versions
          of the game, so the boards would not match. Both of you refresh the
          page, then start the match again.
        </p>
      )}

      {error && <p className="online-error">{error}</p>}

      {game && (
        // Tinted to match the snakes, so the scoreboard itself says which one is
        // yours without anybody having to remember a colour.
        <div className="snake-status">
          <span className="snake-score is-you">
            <span className="snake-score-label">You</span>
            <strong>{mySnake?.score ?? 0}</strong>
          </span>
          <span className="snake-score is-them">
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
            nextState={glide.next}
            progress={glide.progress}
            onSteer={over || countdown !== null ? null : steer}
            facing={facing}
            // Your own snake is always the green one, on both screens - the
            // colour follows the player, not the seat, so there is nothing to
            // remember and nothing to get the wrong way round.
            palette={seat === 0 ? ['p1', 'p2'] : ['p2', 'p1']}
            localIndex={seat}
          />

          {countdown !== null && (
            <div className="snake-overlay">
              <p className="snake-countdown">{countdown}</p>
              {/* Green on both screens, matching the palette above. This used
                  to read "blue" for the guest while their snake was drawn
                  green and their opponent's blue - the exact opposite of the
                  truth, at the one moment players look for the answer. */}
              <p className="snake-overlay-copy">
                You are the <strong className="snake-you-word">green</strong> snake
                {' '}with the ring
              </p>
              {latency !== null && (
                <p className="snake-ping">
                  {latency}ms to your friend
                  {latency > SLOW_PING_MS ? ' · may stutter' : ''}
                </p>
              )}
            </div>
          )}

          {/* A badge, not a panel over the board. Neither of these stops play
              any more - the referee never pauses for a late input - so covering
              the game to announce them was doing more damage than the hiccup.
              A dropped connection outranks quiet, because it explains it. */}
          {DEBUG && diag && (
            <pre className="snake-diag">
{`${roleLabel(duelRef)}  fps ${diag.fps}  stuck ${diag.pinned}%
beat ${diag.beat ? `${diag.beat.mean}ms  min ${diag.beat.min}  max ${diag.beat.max}  p90 ${diag.beat.p90}` : '-'}
late ${diag.beat?.late ?? 0}/${diag.beat?.n ?? 0}   redo ${diag.beat?.rollbacks ?? 0}   ping ${latency ?? '-'}ms`}
            </pre>
          )}

          {!over && connection !== 'connected' && (
            <p className="snake-badge">{CONNECTION_COPY[connection] ?? 'Reconnecting…'}</p>
          )}
          {!over && connection === 'connected' && stalled && countdown === null && (
            <p className="snake-badge">Waiting for {room.opponentName || 'your friend'}…</p>
          )}
        </div>
      )}

      {game && !over && countdown === null && <DuelPad onSteer={steer} />}
    </div>
  )
}

/** "referee" or "guest" - which side of the duel this screen is. */
function roleLabel(ref) {
  return ref.current?.isHost ? 'referee' : 'guest'
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
