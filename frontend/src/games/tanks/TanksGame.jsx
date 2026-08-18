import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { MatchResult, RoomHeader, RoomLobby } from '../../components/RoomShell'
import { createDuelLink } from '../../lib/duelSocket'
import { reportResult } from '../../lib/roomsApi'
import { useRoom } from '../../lib/useRoom'
import { useImmersive } from '../../lib/useImmersive'
import TankBoard from './Board'
import { ARENA, RELOAD_MS, predictShot, seedFromString } from './engine'
import { PROTOCOL_VERSION, createDuel } from './authority'
import './Tanks.css'

const COUNTDOWN_MS = 3000
const STALL_WARNING_MS = 1200

const CONNECTION_COPY = {
  connecting: 'Connecting…',
  waking: 'Waking the server — it sleeps after 15 minutes idle, so the first connection can take up to a minute.',
  waiting: 'Waiting for your friend to open the duel…',
  reconnecting: 'Connection dropped — reconnecting, the match is still here…',
  rejected: 'This room no longer has a seat for you. Leave and start a new one.',
  closed: 'Disconnected.',
}

const wrap = (a) => {
  let r = a
  while (r > Math.PI) r -= Math.PI * 2
  while (r < -Math.PI) r += Math.PI * 2
  return r
}
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)

export default function TanksGame() {
  const { room, playerId, error, busy, copied, create, join, rematch, leave, copyCode, refresh } =
    useRoom('tanks')

  const [connection, setConnection] = useState('connecting')
  const [versionGap, setVersionGap] = useState(false)
  const [game, setGame] = useState(null)
  const [countdown, setCountdown] = useState(null)
  const [stalled, setStalled] = useState(false)
  const [reported, setReported] = useState(false)
  const [aim, setAim] = useState(null)
  const [stickAt, setStickAt] = useState(null)

  const linkRef = useRef(null)
  const duelRef = useRef(null)
  const startedRef = useRef(null)
  const countdownTimerRef = useRef(null)
  // Live control state, read by the tick loop. Kept in refs because a pointer
  // move must not cost a React render - it happens far more often than a tick.
  const moveRef = useRef({ mx: 0, my: 0 })
  const aimRef = useRef(null)
  /**
   * True while the FIRE control is held - the button on a phone, the mouse
   * button or space on a desktop. The gun goes off as soon as it reloads.
   *
   * This used to be the aim stick itself, and before that a release-to-fire
   * gesture, and both were wrong in the same way: every adjustment to the aim
   * was also a trigger pull, so you could not line a shot up without letting
   * one go somewhere you did not mean. Aiming and firing are now separate
   * controls and the aim stick cannot discharge the gun at all.
   */
  const holdingRef = useRef(false)
  /** Mirrored into state only so the fire button can look pressed. */
  const [firing, setFiring] = useState(false)
  const keysRef = useRef(new Set())
  const stageRef = useRef(null)

  const matchNumber = room?.matchNumber ?? 1
  const matchRef = useRef(matchNumber)
  matchRef.current = matchNumber
  const seed = room ? seedFromString(`${room.code}:${matchNumber}`) : 0

  useImmersive(Boolean(game) && game.status !== 'over' && countdown === null && room?.status !== 'ABANDONED')

  /* ---- connection ---- */

  useEffect(() => {
    if (!room?.code || !playerId) return undefined
    const link = createDuelLink({
      code: room.code,
      playerId,
      onStatus: (status) => setConnection(status),
      onMessage: (msg) => {
        if (!msg?.k) return
        if (msg.v !== PROTOCOL_VERSION) { setVersionGap(true); return }
        if (msg.m !== matchRef.current) return
        duelRef.current?.receive(msg)
      },
    })
    linkRef.current = link
    return () => { link.close(); linkRef.current = null }
  }, [room?.code, playerId])

  useEffect(() => {
    if (connection !== 'connected') return
    duelRef.current?.resync()
    refresh()
  }, [connection, refresh])

  /* ---- match lifecycle ---- */

  useEffect(() => {
    if (connection !== 'connected' || !room || room.status !== 'PLAYING') return
    const key = `${room.code}:${matchNumber}`
    if (startedRef.current === key) return
    startedRef.current = key

    duelRef.current = createDuel({
      seed,
      role: room.yourRole,
      onState: setGame,
      send: (msg) => linkRef.current?.send({ ...msg, m: matchRef.current }),
    })
    setGame(duelRef.current.state)
    setReported(false)
    setStalled(false)
    setVersionGap(false)
    moveRef.current = { mx: 0, my: 0 }
    aimRef.current = null
    holdingRef.current = false
    setAim(null)

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

    const loop = (now) => {
      accumulator = Math.min(accumulator + (now - last), 400)
      last = now

      // The stick is translated into tank controls here rather than on every
      // pointer move: a tank turns towards where you are pushing, at a rate the
      // engine caps, so what the loop needs is the CURRENT difference.
      // Keyboard and thumb feed the same two numbers, so both devices play
      // exactly the same game.
      const keys = keysRef.current
      let kx = (keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0)
      let ky = (keys.has('s') || keys.has('arrowdown') ? 1 : 0) - (keys.has('w') || keys.has('arrowup') ? 1 : 0)
      const move = kx || ky ? { mx: kx, my: ky } : moveRef.current
      duel.setInput({ mx: move.mx, my: move.my })
      if (aimRef.current !== null) duel.setInput({ aim: aimRef.current })
      // Held fire keeps shooting as the gun comes back. The reload is the
      // limit, so there is nothing to spam by holding it down.
      if (holdingRef.current || keys.has(' ')) duel.setInput({ fire: true })

      const interval = duel.tickInterval()
      if (accumulator >= interval) {
        accumulator -= interval
        duel.tick()
      }
      setStalled(duel.silentFor() > STALL_WARNING_MS)
      frame = requestAnimationFrame(loop)
    }
    frame = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(frame)
  }, [countdown, connection, game?.status])

  /* ---- controls ---- */

  const onStick = useCallback((event) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const dx = event.clientX - (rect.left + rect.width / 2)
    const dy = event.clientY - (rect.top + rect.height / 2)
    const reach = rect.width / 2.4
    const power = Math.min(Math.hypot(dx, dy) / reach, 1)
    if (power < 0.14) { moveRef.current = { mx: 0, my: 0 }; setStickAt(null); return }
    const angle = Math.atan2(dy, dx)
    moveRef.current = { mx: Math.cos(angle) * power, my: Math.sin(angle) * power }
    setStickAt({ x: Math.cos(angle) * power, y: Math.sin(angle) * power })
  }, [])

  const onAim = useCallback((event) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const dx = event.clientX - (rect.left + rect.width / 2)
    const dy = event.clientY - (rect.top + rect.height / 2)
    if (Math.hypot(dx, dy) < 8) return
    const angle = Math.atan2(dy, dx)
    aimRef.current = angle
    setAim(angle)
  }, [])

  /**
   * Aim by pointing at the board. Only for a mouse: a finger on the board would
   * fight the pads, and on a phone the right-hand stick is the better control.
   */
  const onBoardAim = useCallback((event) => {
    if (event.pointerType === 'touch') return
    const duel = duelRef.current
    const svg = stageRef.current?.querySelector('.tk-layer')
    if (!duel || !svg) return
    const me = duel.state.tanks[duel.localSeat]
    if (!me?.alive) return
    const rect = svg.getBoundingClientRect()
    const ax = ((event.clientX - rect.left) / rect.width) * ARENA.w
    const ay = ((event.clientY - rect.top) / rect.height) * ARENA.h
    const angle = Math.atan2(ay - me.y, ax - me.x)
    aimRef.current = angle
    setAim(angle)
  }, [])

  /**
   * A trigger that is held is a trigger that can get stuck down.
   *
   * The button captures the pointer, so an ordinary release lands on it even
   * if the thumb has slid off - but a release the page never sees at all
   * (the gesture taken over by the browser, the controls unmounting under the
   * thumb as a round ends) leaves the gun held down, and it then fires on its
   * own for the whole of the next round. Listening at the window is the
   * backstop: wherever the release happens, the trigger comes up with it.
   */
  useEffect(() => {
    const release = () => { holdingRef.current = false; setFiring(false) }
    window.addEventListener('pointerup', release)
    window.addEventListener('pointercancel', release)
    window.addEventListener('blur', release)
    return () => {
      window.removeEventListener('pointerup', release)
      window.removeEventListener('pointercancel', release)
      window.removeEventListener('blur', release)
    }
  }, [])

  // And whenever a round is not actually being played, so a trigger held as
  // one round ends cannot carry over into the next.
  useEffect(() => {
    if (countdown !== null || game?.status === 'over') {
      holdingRef.current = false
      setFiring(false)
    }
  }, [countdown, game?.status])

  // Keyboard: WASD or arrows to drive, space to fire, mouse over the board to
  // aim. The page never scrolls on these, which is why they are preventDefault.
  useEffect(() => {
    const down = (e) => {
      const key = e.key.toLowerCase()
      if (['w', 'a', 's', 'd', ' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) {
        if (e.target?.tagName === 'INPUT') return
        e.preventDefault()
        keysRef.current.add(key)
      }
    }
    const up = (e) => keysRef.current.delete(e.key.toLowerCase())
    window.addEventListener('keydown', down, { passive: false })
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  /* ---- reporting ---- */

  useEffect(() => {
    if (!game || game.status !== 'over' || reported || !room) return
    const duel = duelRef.current
    if (!duel) return
    setReported(true)
    if (!duel.isHost) return
    const winnerRole = game.winner === null ? 'draw' : game.winner === 0 ? 'host' : 'guest'
    reportResult(room.code, playerId, winnerRole, 'Tank duel').catch(() => {})
  }, [game?.status, reported, room?.code, playerId])

  /* ---- render ---- */

  if (!room) {
    return (
      <div className="page theme-tanks">
        <Link to="/" className="back-link">← All games</Link>
        <header className="page-header">
          <p className="eyebrow">Arcade</p>
          <h1>Bank Shot</h1>
          <p className="subtitle">Two tanks, one arena. Shells bounce — so does the winning shot.</p>
        </header>
        <main className="game-panel">
          <RoomLobby onCreate={create} onJoin={join} busy={busy} error={error} />
        </main>
      </div>
    )
  }

  const seat = duelRef.current?.localSeat ?? 0
  const waiting = room.status === 'WAITING'
  const abandoned = room.status === 'ABANDONED'
  const over = game?.status === 'over'
  const me = game?.tanks[seat]

  let result = null
  if (over && !abandoned) {
    const iWon = game.winner === seat
    const drawn = game.winner === null
    result = drawn
      ? { outcome: 'draw', emoji: '🤝', title: 'Both destroyed', tier: 'tier-participant', detail: 'Nobody takes the round' }
      : iWon
      ? { outcome: 'win', emoji: '🎯', title: 'Round won', tier: 'tier-gold', detail: 'Their tank is scrap' }
      : { outcome: 'lose', emoji: '💥', title: 'Knocked out', tier: 'tier-silver', detail: `${room.opponentName || 'They'} took the round` }
  }

  // Always drawn, not only while a thumb is down. Aiming was unclear because
  // the guide appeared and vanished with the touch, so there was nothing to
  // line up against between shots.
  //
  // Drawn from the turret's REAL angle, not from where the stick is pointing.
  // The gun traverses now, so for a moment after a big swing those are
  // different - and a guide drawn from the request would promise a shot the
  // tank cannot take yet. Watching the guide sweep round to catch up is also
  // the clearest read on how heavy the turret is.
  const aimAngle = me?.turret ?? null
  const aimPath = game && aimAngle !== null && me?.alive && !over ? predictShot(game, seat, aimAngle) : null

  return (
    <div className="page theme-tanks">
      <Link to="/" className="back-link">← All games</Link>
      <header className="page-header">
        <p className="eyebrow">Arcade</p>
        <h1>Bank Shot</h1>
        <p className="subtitle">Two tanks, one arena. Shells bounce — so does the winning shot.</p>
      </header>

      <main className="game-panel">
        <div className="online-room">
          <RoomHeader room={room} copied={copied} onCopy={copyCode} onLeave={leave} />

          {waiting && (
            <p className="online-share">
              Send <strong>{room.code}</strong> to your friend. They pick Bank Shot → Join.
            </p>
          )}

          {!game && !abandoned && connection !== 'connected' && !(waiting && connection === 'waiting') && (
            <div className={connection === 'rejected' ? 'online-error' : 'online-share'}>
              <p style={{ margin: 0 }}>{CONNECTION_COPY[connection] ?? 'Connecting…'}</p>
            </div>
          )}

          {versionGap && (
            <p className="online-error">
              You and {room.opponentName || 'your friend'} are on different versions of the game.
              Both of you refresh, then start again.
            </p>
          )}
          {error && <p className="online-error">{error}</p>}

          {(result || abandoned) && (
            <MatchResult room={room} result={result} onRematch={rematch} onLeave={leave} busy={busy} />
          )}

          {game && (
            <>
              <div
                className="tk-stage"
                ref={stageRef}
                onPointerMove={onBoardAim}
                onPointerDown={(e) => { if (e.pointerType !== 'touch') { holdingRef.current = true; onBoardAim(e) } }}
                onPointerUp={(e) => { if (e.pointerType !== 'touch') holdingRef.current = false }}
                onPointerLeave={(e) => { if (e.pointerType !== 'touch') holdingRef.current = false }}
              >
                <TankBoard
                  state={game}
                  localSeat={seat}
                  aimPath={aimPath}
                  palette={seat === 0 ? ['p1', 'p2'] : ['p2', 'p1']}
                />

                {countdown !== null && (
                  <div className="tk-overlay">
                    <p className="tk-countdown">{countdown}</p>
                    <p className="tk-overlay-copy">
                      You are the <strong className="tk-you-word">green</strong> tank
                    </p>
                  </div>
                )}

                {!over && connection !== 'connected' && (
                  <p className="tk-badge">{CONNECTION_COPY[connection] ?? 'Reconnecting…'}</p>
                )}
                {!over && connection === 'connected' && stalled && countdown === null && (
                  <p className="tk-badge">Waiting for {room.opponentName || 'your friend'}…</p>
                )}
              </div>

              {!over && countdown === null && (
                <div className="tk-controls">
                  <div
                    className="tk-pad tk-drive"
                    onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); onStick(e) }}
                    onPointerMove={(e) => { if (e.buttons || e.pointerType === 'touch') onStick(e) }}
                    onPointerUp={() => { moveRef.current = { mx: 0, my: 0 }; setStickAt(null) }}
                    onPointerCancel={() => { moveRef.current = { mx: 0, my: 0 }; setStickAt(null) }}
                  >
                    <span className="tk-ring" />
                    <span
                      className="tk-knob"
                      style={stickAt ? { transform: `translate(${stickAt.x * 34}px, ${stickAt.y * 34}px)` } : undefined}
                    />
                    <span className="tk-pad-label">MOVE</span>
                  </div>

                  {/* Aims and only aims. Nothing on this pad can fire. */}
                  <div className="tk-aimside">
                    <div
                      className="tk-pad tk-aimpad"
                      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); onAim(e) }}
                      onPointerMove={(e) => { if (e.buttons || e.pointerType === 'touch') onAim(e) }}
                    >
                      <span className="tk-ring" />
                      {aim !== null && (
                        <span
                          className="tk-aim-needle"
                          style={{ transform: `rotate(${(aim * 180) / Math.PI}deg)` }}
                        />
                      )}
                      <span className="tk-knob is-aim" />
                      <span className="tk-pad-label">AIM</span>
                    </div>

                    {/* The trigger, deliberately its own control and reachable
                        by the same thumb that just finished aiming. */}
                    <button
                      type="button"
                      className={`tk-fire ${firing ? 'is-down' : ''} ${me && me.cooldown === 0 ? 'is-ready' : ''}`}
                      aria-label="Fire"
                      onPointerDown={(e) => {
                        e.currentTarget.setPointerCapture(e.pointerId)
                        holdingRef.current = true
                        setFiring(true)
                      }}
                      onPointerUp={() => { holdingRef.current = false; setFiring(false) }}
                      onPointerCancel={() => { holdingRef.current = false; setFiring(false) }}
                      onContextMenu={(e) => e.preventDefault()}
                    >
                      {/* Reload, on the control that is waiting for it. */}
                      <span
                        className="tk-fire-load"
                        style={{ transform: `scaleY(${me ? 1 - me.cooldown / RELOAD_MS : 1})` }}
                      />
                      <span className="tk-fire-label">FIRE</span>
                    </button>
                  </div>
                </div>
              )}

              <p className="tk-keys">
                <strong>WASD</strong> or arrows to move · <strong>mouse</strong> to aim ·
                <strong> click</strong> or <strong>space</strong> to fire
              </p>
            </>
          )}
        </div>
      </main>
    </div>
  )
}
