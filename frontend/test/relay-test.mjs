// The new duel end to end: two clients over the real WebSocket relay, driving
// the real authority.js and duelSocket.js, wired exactly as SnakeDuel.jsx wires
// them (match number on every message, protocol guard on receive).
//
// The property that matters most is the one lockstep could not give: the
// referee keeps playing while the other side is gone.

const SRC = new URL('../src', import.meta.url).pathname
const { createDuelLink } = await import(`file://${SRC}/lib/duelSocket.js`)
const { createDuel, PROTOCOL_VERSION } = await import(`file://${SRC}/games/snake/authority.js`)
const { seedFromString } = await import(`file://${SRC}/games/snake/engine.js`)

const BASE = 'http://localhost:8080'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
// Compressed clock: nothing in authority.js depends on wall time except the
// glide, so running fast only shortens the test.
const STEP_MS = 12

const GRID = 15
const VEC = { up:{x:0,y:-1}, down:{x:0,y:1}, left:{x:-1,y:0}, right:{x:1,y:0} }
const CW = { up:'right', right:'down', down:'left', left:'up' }

const shape = (s) => s && JSON.stringify({
  tick: s.tick, status: s.status, food: s.food, rng: s.rngState,
  snakes: s.snakes.map((k) => ({ dir: k.dir, alive: k.alive, score: k.score, body: k.body })),
})

const post = (url, body) => fetch(url, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: body ? JSON.stringify(body) : undefined,
}).then((r) => r.json())

function makeClient(code, playerId, role) {
  const c = { role, playerId, status: 'connecting', match: 1, drops: 0, lastTurn: null }
  c.link = createDuelLink({
    code, playerId, baseUrl: BASE,
    onStatus: (s) => {
      if (s === 'reconnecting' && c.status !== 'reconnecting') c.drops++
      c.status = s
      if (s === 'connected') c.duel?.resync()
    },
    onMessage: (msg) => {
      if (!msg?.k || msg.v !== PROTOCOL_VERSION || msg.m !== c.match) return
      c.duel?.receive(msg)
    },
  })
  c.begin = (match, seed) => {
    c.match = match
    c.lastTurn = null
    c.duel = createDuel({
      seed, role,
      onState: () => {},
      send: (msg) => c.link.send({ ...msg, m: c.match }),
    })
  }
  // Circles inside the walls, so a match lasts long enough to mean something.
  c.steer = () => {
    const st = c.duel.state
    const me = st.snakes[c.duel.localSeat]
    if (!me?.alive) return
    const v = VEC[me.dir], h = me.body[0]
    const a = { x: h.x + v.x * 5, y: h.y + v.y * 5 }
    if (a.x < 0 || a.x >= GRID || a.y < 0 || a.y >= GRID) {
      const t = CW[me.dir]
      if (t !== c.lastTurn) { c.lastTurn = t; c.duel.steer(t) }
    }
  }
  return c
}

let pass = 0, fail = 0
const check = (label, ok, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${label}`) }
  else { fail++; console.log(`  FAIL  ${label}${detail ? '\n          ' + detail : ''}`) }
}

const created = await post(`${BASE}/api/rooms`, { gameType: 'snake', playerId: 'h', playerName: 'H' })
const code = created.code
await post(`${BASE}/api/rooms/${code}/join`, { playerId: 'g', playerName: 'G' })
console.log(`room ${code}\n`)

const host = makeClient(code, 'h', 'host')
const guest = makeClient(code, 'g', 'guest')
for (let i = 0; i < 120; i++) {
  if (host.status === 'connected' && guest.status === 'connected') break
  await sleep(50)
}
check('both paired through the relay', host.status === 'connected' && guest.status === 'connected',
  `host=${host.status} guest=${guest.status}`)

/* ---- match 1: long run, with the guest severed mid-match ---- */
host.begin(1, seedFromString(`${code}:1`))
guest.begin(1, seedFromString(`${code}:1`))

let drifted = null, tickWhenSevered = null, ticksDuringOutage = 0, severed = false
for (let i = 0; i < 1400; i++) {
  host.steer(); guest.steer()
  host.duel.tick()

  if (!severed && host.duel.state.tick >= 60) {
    severed = true
    tickWhenSevered = host.duel.state.tick
    // A second socket on the guest's seat displaces the first, exactly as a
    // mobile handover would.
    const intruder = new WebSocket(`ws://localhost:8080/ws/duel?code=${code}&playerId=g`)
    intruder.onopen = () => setTimeout(() => intruder.close(1000, 'done'), 250)
  }
  // Count how far the referee got while the guest was away - under lockstep
  // this would have been zero, because it would have been waiting.
  if (severed && guest.status !== 'connected') ticksDuringOutage = host.duel.state.tick - tickWhenSevered

  if (i % 25 === 0 && drifted === null && guest.status === 'connected' && guest.duel.state.tick > 0) {
    // The guest trails the referee by the flight time; compare only when it has
    // caught up to the same tick.
    if (guest.duel.state.tick === host.duel.state.tick &&
        shape(guest.duel.state) !== shape(host.duel.state)) drifted = host.duel.state.tick
  }
  if (host.duel.state.status === 'over') break
  await sleep(STEP_MS)
}

console.log()
check('guest was severed and reconnected', guest.drops > 0, `drops=${guest.drops}`)
check(`referee kept playing through the outage (${ticksDuringOutage} ticks while alone)`,
  ticksDuringOutage > 0)
check('guest never showed a state the referee disagreed with', drifted === null,
  drifted ? `first drift at tick ${drifted}` : '')

// Wait for the guest to actually be back before judging it. On the compressed
// clock the match can finish inside duelSocket's reconnect backoff, which is a
// property of the test, not of the game.
for (let i = 0; i < 100; i++) {
  if (guest.status === 'connected') break
  await sleep(100)
}
await sleep(600)
check('guest caught back up to the referee exactly (resync after reconnect)',
  shape(guest.duel.state) === shape(host.duel.state),
  `guest tick ${guest.duel.state.tick} vs host ${host.duel.state.tick}`)
console.log(`        match 1 ran ${host.duel.state.tick} ticks, scores ${host.duel.state.snakes.map((s) => s.score).join('-')}`)

/* ---- rematch ---- */
await fetch(`${BASE}/api/rooms/${code}/result?playerId=h&winnerRole=host&note=t`, { method: 'POST' })
await fetch(`${BASE}/api/rooms/${code}/rematch?playerId=h`, { method: 'POST' })
const after = await fetch(`${BASE}/api/rooms/${code}/rematch?playerId=g`, { method: 'POST' }).then((r) => r.json())

host.begin(after.matchNumber, seedFromString(`${code}:${after.matchNumber}`))
guest.begin(after.matchNumber, seedFromString(`${code}:${after.matchNumber}`))
for (let i = 0; i < 600; i++) {
  host.steer(); guest.steer()
  host.duel.tick()
  if (host.duel.state.status === 'over') break
  await sleep(STEP_MS)
}
await sleep(400)
console.log()
check('rematch started a fresh match', after.matchNumber === 2)
check('rematch stayed in sync', shape(guest.duel.state) === shape(host.duel.state),
  `guest tick ${guest.duel.state.tick} vs host ${host.duel.state.tick}`)
console.log(`        match 2 ran ${host.duel.state.tick} ticks`)

host.link.close(); guest.link.close()
await sleep(200)
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
