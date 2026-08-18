// Correction smoothing: the guest's screen, with and without it.
//
// This exists because the bug it covers was invisible on good wifi and obvious
// on mobile data, so "it looks fine here" was never evidence either way. The
// numbers below are the ones a player actually sees - the drawn head, frame by
// frame - and they are measured over a full match at four link qualities.
let VNOW = 0
globalThis.performance = { now: () => VNOW }

const SNAKE = new URL('../src/games/snake', import.meta.url).pathname
const { createDuel, TICK_MS } = await import(`file://${SNAKE}/authority.js`)
const { glidingBody } = await import(`file://${SNAKE}/glide.js`)
const { createSmoother, MAX_SMOOTH_CELLS, SMOOTH_TAU_MS } = await import(`file://${SNAKE}/smooth.js`)
const { seedFromString } = await import(`file://${SNAKE}/engine.js`)

let pass = 0, fail = 0
const check = (label, ok, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${label}`) }
  else { fail++; console.log(`  FAIL  ${label}${detail ? '\n          ' + detail : ''}`) }
}

const FRAME = 16.7, GRID = 15
const VEC = { up:{x:0,y:-1}, down:{x:0,y:1}, left:{x:-1,y:0}, right:{x:1,y:0} }
const CW = { up:'right', right:'down', down:'left', left:'up' }
const prng = (s0) => { let s = s0>>>0; return () => (s = (s*1664525+1013904223)>>>0, s/4294967296) }

/** A full duel over a lossy link, reporting what the GUEST drew. */
function duel({ oneWay, jitter, spike, spikeChance, smooth, seconds = 90, seed = 11 }) {
  VNOW = 0
  const rand = prng(seed), inflight = []
  const sm = createSmoother()
  let guest = null
  const send = (to) => (m) => inflight.push({
    at: VNOW + oneWay + rand()*jitter + (rand() < spikeChance ? spike : 0), to, m })
  const host = createDuel({ seed: seedFromString('S:1'), role: 'host', onState(){}, send: send('guest') })
  guest = createDuel({ seed: seedFromString('S:1'), role: 'guest', onState(){}, send: send('host') })

  const steerAway = (d, seat, memo) => {
    const me = d.state.snakes[seat]
    if (!me?.alive) return
    const v = VEC[me.dir], h = me.body[0]
    const a = { x: h.x + v.x*4, y: h.y + v.y*4 }
    if (a.x<0||a.x>=GRID||a.y<0||a.y>=GRID) {
      const t = CW[me.dir]; if (t !== memo.last) { memo.last = t; d.steer(t) }
    }
  }
  const hm = {last:null}, gm = {last:null}
  let accH = 0, accG = 0, last = 0
  const drawn = []
  while (VNOW < seconds*1000 && host.state.status !== 'over') {
    VNOW += FRAME
    for (let i = inflight.length-1; i >= 0; i--) {
      if (inflight[i].at <= VNOW) { const {to,m} = inflight[i]; (to==='guest'?guest:host).receive(m); inflight.splice(i,1) }
    }
    const dt = VNOW - last; last = VNOW
    accH = Math.min(accH+dt, 500); accG = Math.min(accG+dt, 500)
    steerAway(host,0,hm); steerAway(guest,1,gm)
    if (accH >= host.tickInterval()) { accH -= host.tickInterval(); host.tick() }
    if (accG >= guest.tickInterval()) { accG -= guest.tickInterval(); guest.tick() }
    const sn = guest.state.snakes[1]
    if (!sn) continue
    let pts = glidingBody(sn, guest.peekNext()?.snakes?.[1] ?? null, guest.progress())
    if (smooth) pts = sm.apply(pts, VNOW, TICK_MS)
    drawn.push({ x: pts[0].x, y: pts[0].y, alive: sn.alive })
  }
  // The worst backwards jump, which is the thing that reads as "the snake got
  // confused". A turn is a 90-degree change and scores zero here; only motion
  // AGAINST the direction of travel counts.
  let prev = drawn[0], prevD = null, worst = 0
  for (let i = 1; i < drawn.length; i++) {
    const p = drawn[i]
    if (!p.alive) break
    const dx = p.x-prev.x, dy = p.y-prev.y, d = Math.hypot(dx,dy)
    if (prevD && d > 1e-6 && dx*prevD.dx + dy*prevD.dy < -1e-9) worst = Math.max(worst, d)
    if (d > 1e-6) prevD = { dx, dy }
    prev = p
  }
  return worst
}

const NETS = [
  ['good wifi',   { oneWay:80,  jitter:20,  spike:260, spikeChance:0.02 }],
  ['Singapore',   { oneWay:80,  jitter:35,  spike:260, spikeChance:0.04 }],
  ['mobile data', { oneWay:150, jitter:80,  spike:400, spikeChance:0.08 }],
  ['poor mobile', { oneWay:250, jitter:150, spike:700, spikeChance:0.12 }],
]

console.log(`TICK_MS=${TICK_MS}  tau=${SMOOTH_TAU_MS}ms  cap=${MAX_SMOOTH_CELLS} cells\n`)
console.log('worst backwards jump the guest draws:')
for (const [label, net] of NETS) {
  const before = duel({ ...net, smooth: false })
  const after  = duel({ ...net, smooth: true })
  // Under a cell is inside the snake's own body: there is nothing to see.
  check(`${label.padEnd(12)} ${before.toFixed(2)} -> ${after.toFixed(2)} cells`,
    after < 1.0, `still jumps ${after.toFixed(2)} cells`)
  check(`${label.padEnd(12)} and smoothing actually helped`,
    after <= before + 1e-9, `${after.toFixed(2)} is no better than ${before.toFixed(2)}`)
}

console.log('\nthe smoother stays out of the way when nothing is wrong:')
{
  // Ordinary gliding must pass through untouched, or every snake everywhere
  // would drag behind its own position.
  const sm = createSmoother()
  let t = 0, drift = 0
  for (let i = 0; i < 200; i++) {
    const truth = [{ x: 5 + i * 0.0759, y: 7 }]
    const out = sm.apply(truth, t, TICK_MS)
    drift = Math.max(drift, Math.hypot(out[0].x - truth[0].x, out[0].y - truth[0].y))
    t += FRAME
  }
  check('steady movement is drawn exactly where it is', drift < 1e-9, `drifted ${drift}`)

  // And a correction must actually settle, not leave the snake permanently off.
  const sm2 = createSmoother()
  let u = 0
  sm2.apply([{ x: 0, y: 0 }], u, TICK_MS); u += FRAME
  sm2.apply([{ x: 4, y: 0 }], u, TICK_MS); u += FRAME   // a 4-cell correction
  for (let i = 0; i < 90; i++) { sm2.apply([{ x: 4, y: 0 }], u, TICK_MS); u += FRAME }
  const settled = sm2.apply([{ x: 4, y: 0 }], u, TICK_MS)
  check('a correction fully settles onto the truth',
    Math.hypot(settled[0].x - 4, settled[0].y) < 1e-9,
    `left at ${settled[0].x.toFixed(3)},${settled[0].y.toFixed(3)}`)
}

console.log('\nsmoothing belongs to the duel and nowhere else:')
{
  // The trap, written down because it already caught us once. The solo game
  // passes no `next` and no `progress`, so glidingBody hands back the raw body
  // and the head moves a WHOLE CELL the instant a tick lands. The smoother
  // cannot tell that from a correction - it eases every tick, and the solo
  // snake ends up drawn permanently behind itself.
  const sm = createSmoother()
  let t = 0, x = 2, since = 0, worstLag = 0
  for (let f = 0; f < 600; f++) {
    t += FRAME; since += FRAME
    if (since >= TICK_MS) { since -= TICK_MS; x += 1 }
    const snake = { body: [{x,y:7},{x:x-1,y:7},{x:x-2,y:7}], alive: true, dir: 'right' }
    const out = sm.apply(glidingBody(snake, null, 0), t, TICK_MS)
    worstLag = Math.max(worstLag, Math.abs(out[0].x - x))
  }
  check('whole-cell steps ARE treated as corrections - so ungliding boards must not smooth',
    worstLag > 0.2,
    `only lagged ${worstLag.toFixed(3)} cells; if this ever stops being true, re-check why Board.jsx gates on smoothCorrections`)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
