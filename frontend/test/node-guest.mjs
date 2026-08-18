// A guest that joins a room and plays, so the browser host has a live opponent.
const SRC = new URL('../src', import.meta.url).pathname
const { createDuelLink } = await import(`file://${SRC}/lib/duelSocket.js`)
const { createDuel, PROTOCOL_VERSION } = await import(`file://${SRC}/games/snake/authority.js`)
const { seedFromString } = await import(`file://${SRC}/games/snake/engine.js`)

const BASE = 'http://localhost:8080'
const CODE = process.argv[2]
const PLAYER = process.argv[3] ?? 'node-guest'
if (!CODE) throw new Error('usage: node node-guest.mjs <ROOMCODE> [playerId]')

await fetch(`${BASE}/api/rooms/${CODE}/join`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ playerId: PLAYER, playerName: 'NodeGuest' }),
}).then((r) => r.text())

let match = 1
let duel = null
const link = createDuelLink({
  code: CODE, playerId: PLAYER, baseUrl: BASE,
  onStatus: (s) => console.log('status:', s),
  onMessage: (m) => {
    if (!m?.k || m.v !== PROTOCOL_VERSION || m.m !== match) return
    duel?.receive(m)
  },
})
duel = createDuel({
  seed: seedFromString(`${CODE}:${match}`), role: 'guest',
  onState: () => {},
  send: (m) => link.send({ ...m, m: match }),
})
setInterval(() => fetch(`${BASE}/api/rooms/${CODE}?playerId=${PLAYER}`).catch(() => {}), 1500)
// Circle inside the walls so the match lasts long enough to inspect.
const VEC = { up:{x:0,y:-1}, down:{x:0,y:1}, left:{x:-1,y:0}, right:{x:1,y:0} }
const CW = { up:'right', right:'down', down:'left', left:'up' }
let lastTurn = null
setInterval(() => {
  const st = duel.state
  const me = st.snakes[1]
  if (me?.alive) {
    const v = VEC[me.dir], h = me.body[0]
    const a = { x: h.x + v.x * 5, y: h.y + v.y * 5 }
    if (a.x < 0 || a.x >= 15 || a.y < 0 || a.y >= 15) {
      const t = CW[me.dir]
      if (t !== lastTurn) { lastTurn = t; duel.steer(t) }
    }
  }
  duel.tick()
}, 220)
console.log(`node guest in room ${CODE}`)
