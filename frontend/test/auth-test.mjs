// The claims the new netcode is making, checked directly.
const SNAKE = new URL('../src/games/snake', import.meta.url).pathname
const { createDuel, TICK_MS, PROTOCOL_VERSION } = await import(`file://${SNAKE}/authority.js`)
const { createState, step, seedFromString } = await import(`file://${SNAKE}/engine.js`)

const SEED = seedFromString('AUTH:1')
let pass = 0, fail = 0
const check = (label, ok, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${label}`) }
  else { fail++; console.log(`  FAIL  ${label}${detail ? '\n          ' + detail : ''}`) }
}
const shape = (s) => JSON.stringify({
  tick: s.tick, status: s.status, food: s.food, rng: s.rngState,
  snakes: s.snakes.map((k) => ({ dir: k.dir, alive: k.alive, score: k.score, body: k.body })),
})

/** A pair wired straight together, with a controllable delivery queue. */
function pair() {
  const link = { hostInbox: [], guestInbox: [], deliver: true }
  const host = createDuel({
    seed: SEED, role: 'host', onState: () => {},
    send: (m) => (link.deliver ? guest.receive(m) : link.guestInbox.push(m)),
  })
  const guest = createDuel({
    seed: SEED, role: 'guest', onState: () => {},
    send: (m) => (link.deliver ? host.receive(m) : link.hostInbox.push(m)),
  })
  return { host, guest, link }
}

console.log(`TICK_MS=${TICK_MS}  protocol v${PROTOCOL_VERSION}\n`)

/* ---- 1. a turn lands on the very next tick ---- */
console.log('input latency:')
{
  const { host, guest } = pair()
  host.tick()                                    // -> tick 1, snapshot to guest
  check('guest sees the referee state', guest.state.tick === 1)
  const before = guest.state.snakes[1].dir
  guest.steer('down')
  // The guest's own screen reacts immediately, before any round trip.
  check('guest predicts its own turn instantly (same frame)',
    host.state.tick === 1 && guest.peekNext()?.snakes[1].dir === 'down')
  host.tick()                                    // -> tick 2
  check(`turn takes effect on the NEXT tick (was ${before}, now ${host.state.snakes[1].dir})`,
    host.state.tick === 2 && host.state.snakes[1].dir === 'down')
}

/* ---- 2. the referee never waits for the other player ---- */
console.log('\nno waiting:')
{
  const { host, guest, link } = pair()
  link.deliver = false                           // guest is completely silent
  for (let i = 0; i < 12; i++) host.tick()
  check('referee advanced 12 ticks with a silent opponent', host.state.tick === 12,
    `got tick ${host.state.tick}`)
  check('guest fell behind rather than blocking the host', guest.state.tick === 0)
}

/* ---- 3. a late turn is still honoured at the tick it was meant for ---- */
console.log('\nrollback:')
{
  const { host, link } = pair()
  link.deliver = false
  for (let i = 0; i < 5; i++) host.tick()        // referee is at tick 5
  check('referee reached tick 5', host.state.tick === 5)

  // The turn was tagged for tick 4 but only arrives now - a third of turns miss
  // their boundary at 220ms a tick.
  host.receive({ k: 'u', v: PROTOCOL_VERSION, t: 4, d: 'down' })

  // What it should look like: the same match with that turn applied on time.
  let want = createState(SEED, 2)
  for (let t = 1; t <= 5; t++) want = step(want, t === 4 ? { 1: 'down' } : {})

  check('history redone so the late turn took effect at tick 4',
    shape(host.state) === shape(want),
    `got  ${shape(host.state).slice(0, 150)}\n          want ${shape(want).slice(0, 150)}`)
  check('still at tick 5 afterwards (rewound and replayed, not rewound and left)',
    host.state.tick === 5)
}

/* ---- 4. a turn too old to honour is dropped, not misapplied ---- */
console.log('\nstale input:')
{
  const { host, link } = pair()
  link.deliver = false
  for (let i = 0; i < 10; i++) host.tick()
  const before = shape(host.state)
  host.receive({ k: 'u', v: PROTOCOL_VERSION, t: 2, d: 'down' })   // 8 ticks late
  check('ignored rather than rewriting the match', shape(host.state) === before)
}

/* ---- 5. wrong protocol is refused ---- */
console.log('\nversion guard:')
{
  const { host, link } = pair()
  link.deliver = false
  host.tick()
  const before = shape(host.state)
  host.receive({ k: 'u', v: PROTOCOL_VERSION + 1, t: 2, d: 'down' })
  check('input from another build is refused', shape(host.state) === before)
}

/* ---- 6. the two sides agree over a long match ---- */
console.log('\nconvergence:')
{
  const { host, guest } = pair()
  const GRID = 15
  const VEC = { up:{x:0,y:-1}, down:{x:0,y:1}, left:{x:-1,y:0}, right:{x:1,y:0} }
  const CW = { up:'right', right:'down', down:'left', left:'up' }
  const OPP = { up:'down', down:'up', left:'right', right:'left' }
  // Chases the food with only a one-cell safety check, so the snakes really do
  // eat, grow and eventually crash - a match, not a holding pattern.
  const steerAway = (duel, seat) => {
    const st = duel.state
    const me = st.snakes[seat]
    if (!me?.alive || !st.food) return
    const h = me.body[0]
    const dx = st.food.x - h.x, dy = st.food.y - h.y
    const options = Math.abs(dx) > Math.abs(dy)
      ? [dx > 0 ? 'right' : 'left', dy > 0 ? 'down' : 'up']
      : [dy > 0 ? 'down' : 'up', dx > 0 ? 'right' : 'left']
    for (const want of options) {
      if (want === OPP[me.dir] || !dx && !dy) continue
      const nv = VEC[want]
      const n = { x: h.x + nv.x, y: h.y + nv.y }
      if (n.x < 0 || n.x >= GRID || n.y < 0 || n.y >= GRID) continue
      if (want !== me.dir) duel.steer(want)
      return
    }
  }

  let ticks = 0
  let drifted = null
  while (host.state.status !== 'over' && ticks < 2000) {
    steerAway(host, 0)
    steerAway(guest, 1)
    host.tick()
    ticks++
    // Sampled throughout rather than only at the end: a divergence that healed
    // would otherwise pass unnoticed.
    if (ticks % 50 === 0 && drifted === null && shape(host.state) !== shape(guest.state)) {
      drifted = ticks
    }
  }
  check(`guest never drifted from the referee across ${ticks} ticks`, drifted === null,
    drifted ? `first drift at tick ${drifted}` : '')
  check('snakes ate and grew, so a rollback had to replay changing lengths',
    host.state.snakes.some((k) => k.body.length > 3), `lengths ${host.state.snakes.map((k) => k.body.length)}`)
  check('match reached a result', host.state.status === 'over', `tick ${host.state.tick}`)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
