// A second tank, so the browser has an opponent to test against. Drives in a
// slow arc and fires on a timer - enough to see the arena move and break.
const SRC = new URL('../src', import.meta.url).pathname
const { createDuelLink } = await import(`file://${SRC}/lib/duelSocket.js`)
const { createDuel, PROTOCOL_VERSION } = await import(`file://${SRC}/games/tanks/authority.js`)
const { seedFromString, TICK_MS } = await import(`file://${SRC}/games/tanks/engine.js`)

const BASE = 'http://localhost:8080'
const CODE = process.argv[2]
const PLAYER = process.argv[3] ?? 'tank-guest'
if (!CODE) throw new Error('usage: node tank-guest.mjs <ROOMCODE>')

await fetch(`${BASE}/api/rooms/${CODE}/join`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ playerId: PLAYER, playerName: 'NodeTank' }),
}).then((r) => r.text())

let match = 1
let duel = null
const link = createDuelLink({
  code: CODE,
  playerId: PLAYER,
  baseUrl: BASE,
  onStatus: (s) => console.log('status:', s),
  onMessage: (m) => {
    if (m?.k && m.v === PROTOCOL_VERSION && m.m === match) duel?.receive(m)
  },
})
duel = createDuel({
  seed: seedFromString(`${CODE}:${match}`),
  role: 'guest',
  onState: () => {},
  send: (m) => link.send({ ...m, m: match }),
})
setInterval(() => fetch(`${BASE}/api/rooms/${CODE}?playerId=${PLAYER}`).catch(() => {}), 1500)

let n = 0
setInterval(() => {
  n++
  duel.setInput({
    mx: Math.cos(n / 30),
    my: Math.sin(n / 30),
    aim: ((n / 60) % (Math.PI * 2)) - Math.PI,
  })
  if (n % 45 === 0) duel.setInput({ fire: true })
  duel.tick()
  if (n % 90 === 0) {
    const s = duel.state
    console.log(`tick ${s.tick}  shells ${s.shells.length}  status ${s.status}`)
  }
}, TICK_MS)
console.log(`node tank in room ${CODE}`)
