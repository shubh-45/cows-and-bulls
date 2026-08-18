// Host and guest, both here, talking through the real relay - the path the
// browser actually uses. Reproduces the early death seen in the browser.
const SRC = new URL('../src', import.meta.url).pathname
const { createDuelLink } = await import(`file://${SRC}/lib/duelSocket.js`)
const { createDuel, PROTOCOL_VERSION } = await import(`file://${SRC}/games/tanks/authority.js`)
const { seedFromString, TICK_MS } = await import(`file://${SRC}/games/tanks/engine.js`)

const BASE = 'http://localhost:8080'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const post = (url, body) => fetch(url, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: body ? JSON.stringify(body) : undefined,
}).then((r) => r.json())

const created = await post(`${BASE}/api/rooms`, { gameType: 'tanks', playerId: 'h', playerName: 'H' })
const code = created.code
await post(`${BASE}/api/rooms/${code}/join`, { playerId: 'g', playerName: 'G' })
console.log('room', code)

function client(role, playerId) {
  const c = { role, status: 'connecting' }
  c.link = createDuelLink({
    code, playerId, baseUrl: BASE,
    onStatus: (s) => { c.status = s },
    onMessage: (m) => {
      if (m?.k && m.v === PROTOCOL_VERSION && m.m === 1) c.duel.receive(m)
    },
  })
  c.duel = createDuel({
    seed: seedFromString(`${code}:1`), role,
    onState: () => {},
    send: (m) => c.link.send({ ...m, m: 1 }),
  })
  return c
}

const host = client('host', 'h')
const guest = client('guest', 'g')
for (let i = 0; i < 100; i++) {
  if (host.status === 'connected' && guest.status === 'connected') break
  await sleep(50)
}
console.log('paired:', host.status, guest.status)

let n = 0
for (let i = 0; i < 200; i++) {
  n++
  // Exactly what the node opponent does, and the host sits still like an
  // untouched browser.
  guest.duel.setInput({ mx: Math.cos(n / 30), my: Math.sin(n / 30), aim: ((n / 60) % (Math.PI * 2)) - Math.PI })
  if (n % 45 === 0) guest.duel.setInput({ fire: true })
  host.duel.setInput({ mx: 0, my: 0 })

  host.duel.tick()
  guest.duel.tick()

  const s = host.duel.state
  if (s.events.length) {
    console.log(`  tick ${s.tick}`, JSON.stringify(s.events))
  }
  if (i === 60) {
    const g = s.tanks[1]
    console.log(`  guest tank after 60 ticks: ${g.x.toFixed(1)},${g.y.toFixed(1)} (spawned 80,26)`)
  }
  if (s.status === 'over') {
    console.log(`OVER at tick ${s.tick}, winner ${s.winner}`)
    console.log('  tanks:', s.tanks.map((t) => `${t.id}: ${t.x.toFixed(1)},${t.y.toFixed(1)} alive=${t.alive}`).join('  '))
    break
  }
  await sleep(TICK_MS)
}
if (host.duel.state.status !== 'over') {
  console.log('survived 200 ticks; guest at', host.duel.state.tanks[1].x.toFixed(1), host.duel.state.tanks[1].y.toFixed(1))
}
host.link.close(); guest.link.close()
await sleep(200)
process.exit(0)
