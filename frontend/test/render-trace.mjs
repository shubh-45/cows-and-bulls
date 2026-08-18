// What the two screens ACTUALLY draw, frame by frame, on a virtual clock.
//
// The duel's rendered position is a pure function of (state, nextState,
// progress), so smoothness is measurable without a browser: drive both sides'
// real loops over simulated time and record where each snake's head is drawn on
// every frame. Stutter is then arithmetic - a frame with no movement is a
// freeze, a frame with a big movement is a jump.
//
// Time is injected by overriding performance.now BEFORE importing the modules,
// because authority.js reads it for its own clock.

let VNOW = 0
globalThis.performance = { now: () => VNOW }

const SNAKE = new URL('../src/games/snake', import.meta.url).pathname
const { createDuel, TICK_MS } = await import(`file://${SNAKE}/authority.js`)
const { glidingBody } = await import(`file://${SNAKE}/glide.js`)
const { seedFromString } = await import(`file://${SNAKE}/engine.js`)

/* ---- conditions ---- */
const FRAME_MS = 16.7
const ONE_WAY = 80          // measured to the Singapore relay
const JITTER = 35           // ordinary mobile wobble
const SPIKE_MS = 260        // occasional congestion
const SPIKE_CHANCE = 0.04
const STALL_CHANCE = 0.02   // a phone's rAF pausing (scroll, chrome, low power)
const STALL_MS = [120, 460]

function prng(seed) {
  let s = seed >>> 0
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
}

const GRID = 15
const VEC = { up:{x:0,y:-1}, down:{x:0,y:1}, left:{x:-1,y:0}, right:{x:1,y:0} }
const CW = { up:'right', right:'down', down:'left', left:'up' }

/**
 * @param hostStalls whether the referee's animation frames stall like a phone's
 */
function run({ seconds = 40, hostStalls = true, seed = 7 } = {}) {
  VNOW = 0
  const rand = prng(seed)
  const inflight = []
  let guest = null

  const host = createDuel({
    seed: seedFromString('TRACE:1'), role: 'host',
    onState: () => {},
    send: (m) => {
      const spike = rand() < SPIKE_CHANCE ? SPIKE_MS : 0
      inflight.push({ at: VNOW + ONE_WAY + rand() * JITTER + spike, to: 'guest', m })
    },
  })
  guest = createDuel({
    seed: seedFromString('TRACE:1'), role: 'guest',
    onState: () => {},
    send: (m) => {
      const spike = rand() < SPIKE_CHANCE ? SPIKE_MS : 0
      inflight.push({ at: VNOW + ONE_WAY + rand() * JITTER + spike, to: 'host', m })
    },
  })

  const steerAway = (duel, seat, memo) => {
    const st = duel.state
    const me = st.snakes[seat]
    if (!me?.alive) return
    const v = VEC[me.dir], h = me.body[0]
    const a = { x: h.x + v.x * 5, y: h.y + v.y * 5 }
    if (a.x < 0 || a.x >= GRID || a.y < 0 || a.y >= GRID) {
      const t = CW[me.dir]
      if (t !== memo.last) { memo.last = t; duel.steer(t) }
    }
  }
  const hostMemo = { last: null }, guestMemo = { last: null }

  // Where each side draws its OWN snake's head this frame.
  const drawn = { host: [], guest: [] }
  const headOf = (duel) => {
    const st = duel.state
    const next = duel.peekNext()
    const seat = duel.localSeat
    const snake = st.snakes[seat]
    if (!snake) return null
    const pts = glidingBody(snake, next?.snakes?.[seat] ?? null, duel.progress())
    return { x: pts[0].x, y: pts[0].y, alive: snake.alive }
  }

  let accHost = 0, accGuest = 0
  let last = 0
  const horizon = seconds * 1000

  while (VNOW < horizon && host.state.status !== 'over') {
    // --- advance virtual time by one animation frame (with mobile stalls) ---
    let dt = FRAME_MS
    if (hostStalls && rand() < STALL_CHANCE) {
      dt = STALL_MS[0] + rand() * (STALL_MS[1] - STALL_MS[0])
    }
    VNOW += dt

    // --- deliver anything that has arrived ---
    for (let i = inflight.length - 1; i >= 0; i--) {
      if (inflight[i].at <= VNOW) {
        const { to, m } = inflight[i]
        ;(to === 'guest' ? guest : host).receive(m)
        inflight.splice(i, 1)
      }
    }

    // --- the referee's loop, exactly as SnakeDuel runs it ---
    const dtFrame = VNOW - last
    last = VNOW
    accHost = Math.min(accHost + dtFrame, 500)
    accGuest = Math.min(accGuest + dtFrame, 500)
    steerAway(host, 0, hostMemo)
    steerAway(guest, 1, guestMemo)
    if (accHost >= host.tickInterval()) { accHost -= host.tickInterval(); host.tick() }
    if (accGuest >= guest.tickInterval()) { accGuest -= guest.tickInterval(); guest.tick() }

    // --- what each screen draws this frame ---
    const h = headOf(host), g = headOf(guest)
    if (h) drawn.host.push({ t: VNOW, ...h })
    if (g) drawn.guest.push({ t: VNOW, ...g })
  }

  return drawn
}

/** Turns a list of drawn head positions into the numbers a player feels. */
function analyse(points, label) {
  const moves = []
  let frozenRun = 0, worstFreeze = 0, jumps = 0, reversals = 0, stillFrames = 0
  let prev = points[0], prevDelta = null

  for (let i = 1; i < points.length; i++) {
    const p = points[i]
    if (!p.alive) break
    const dx = p.x - prev.x, dy = p.y - prev.y
    const d = Math.hypot(dx, dy)
    const gap = p.t - prev.t
    moves.push(d)

    if (d < 1e-6) {
      stillFrames++
      frozenRun += gap
      worstFreeze = Math.max(worstFreeze, frozenRun)
    } else {
      frozenRun = 0
    }
    // A jump has to be measured against the time the frame actually took: a
    // 460ms stalled frame SHOULD move the head two cells, and calling that a
    // teleport hides the real ones. Anything well beyond what the elapsed time
    // allows is a genuine discontinuity.
    const allowed = (gap / TICK_MS) * 1.6 + 0.05
    if (d > allowed) jumps++
    if (prevDelta && d > 1e-6) {
      const dot = dx * prevDelta.dx + dy * prevDelta.dy
      if (dot < -1e-9) reversals++
    }
    if (d > 1e-6) prevDelta = { dx, dy }
    prev = p
  }

  const expected = 1 / (TICK_MS / FRAME_MS)
  return {
    label,
    frames: points.length,
    stillPct: Math.round((stillFrames / Math.max(points.length, 1)) * 100),
    worstFreezeMs: Math.round(worstFreeze),
    jumps,
    reversals,
    meanStep: (moves.reduce((a, b) => a + b, 0) / Math.max(moves.length, 1)).toFixed(4),
    expectedStep: expected.toFixed(4),
  }
}

const show = (r) => console.log(
  `  ${r.label.padEnd(9)} frames ${String(r.frames).padStart(5)}  ` +
  `still ${String(r.stillPct).padStart(3)}%  longest-freeze ${String(r.worstFreezeMs).padStart(4)}ms  ` +
  `jumps ${String(r.jumps).padStart(3)}  snap-backs ${String(r.reversals).padStart(3)}  ` +
  `step ${r.meanStep} (want ~${r.expectedStep})`)

console.log(`TICK_MS=${TICK_MS}  frame=${FRAME_MS}ms  one-way=${ONE_WAY}ms +jitter ${JITTER}ms\n`)

console.log('phone-like referee (rAF stalls, network jitter + spikes):')
{
  const d = run({ hostStalls: true })
  show(analyse(d.host, 'referee'))
  show(analyse(d.guest, 'guest'))
}

console.log('\nperfect referee clock (no rAF stalls), same network:')
{
  const d = run({ hostStalls: false })
  show(analyse(d.host, 'referee'))
  show(analyse(d.guest, 'guest'))
}
