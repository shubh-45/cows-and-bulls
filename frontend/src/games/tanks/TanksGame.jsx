import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { MatchResult, RoomHeader, RoomLobby } from '../../components/RoomShell'
import { createDuelLink } from '../../lib/duelSocket'
import { reportResult } from '../../lib/roomsApi'
import { useRoom } from '../../lib/useRoom'
import { useImmersive } from '../../lib/useImmersive'
import TankBoard from './Board'
import { predictShot, seedFromString } from './engine'
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

  const linkRef = useRef(null)
  const duelRef = useRef(null)
  const startedRef = useRef(null)
  const countdownTimerRef = useRef(null)
  // Live control state, read by the tick loop. Kept in refs because a pointer
  // move must not cost a React render - it happens far more often than a tick.
  const stickRef = useRef(null)
  const aimRef = useRef(null)

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
    stickRef.current = null
    aimRef.current = null
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
      const me = duel.state.tanks[duel.localSeat]
      const stick = stickRef.current
      if (me) {
        if (stick && stick.power > 0.12) {
          const diff = wrap(stick.angle - me.heading)
          duel.setInput({ drive: Math.abs(diff) > 2.2 ? -stick.power : stick.power * Math.max(0.25, 1 - Math.abs(diff)), steer: clamp(diff * 2.6, -1, 1) })
        } else {
          duel.setInput({ drive: 0, steer: 0 })
        }
        if (aimRef.current !== null) duel.setInput({ aim: aimRef.current })
      }

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
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    const dx = event.clientX - cx
    const dy = event.clientY - cy
    const reach = rect.width / 2
    stickRef.current = {
      angle: Math.atan2(dy, dx),
      power: clamp(Math.hypot(dx, dy) / reach, 0, 1),
      dx: clamp(dx / reach, -1, 1),
      dy: clamp(dy / reach, -1, 1),
    }
  }, [])

  const onAim = useCallback((event) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    const angle = Math.atan2(event.clientY - cy, event.clientX - cx)
    aimRef.current = angle
    setAim(angle)
  }, [])

  const fire = useCallback(() => {
    duelRef.current?.setInput({ fire: true })
    setAim(null)
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

  const aimPath = game && aim !== null && me?.alive ? predictShot(game, seat, aim) : null

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
              <div className="tk-stage">
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
                    onPointerUp={() => { stickRef.current = null }}
                    onPointerCancel={() => { stickRef.current = null }}
                  >
                    <span className="tk-pad-label">DRIVE</span>
                  </div>

                  <div
                    className="tk-pad tk-aimpad"
                    onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); onAim(e) }}
                    onPointerMove={(e) => { if (e.buttons || e.pointerType === 'touch') onAim(e) }}
                    onPointerUp={fire}
                    onPointerCancel={() => setAim(null)}
                  >
                    <span className="tk-pad-label">
                      {me && me.cooldown > 0 ? 'RELOADING' : 'AIM · RELEASE TO FIRE'}
                    </span>
                    {me && (
                      <span
                        className="tk-reload"
                        style={{ transform: `scaleX(${1 - me.cooldown / 900})` }}
                      />
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  )
}
