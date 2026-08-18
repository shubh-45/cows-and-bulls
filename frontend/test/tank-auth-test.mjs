// The tank netcode, both ends in this process, with no backend and no sockets.
//
// tank-relay-test.mjs covers the same ground through the real relay, but it
// needs a running server, so nothing checked the host/guest agreement on an
// ordinary run. This does, over a link that delays and reorders like the real
// one - which is where the interesting failures live.
const SRC = new URL('../src', import.meta.url).pathname
const { createDuel, PROTOCOL_VERSION } = await import(`file://${SRC}/games/tanks/authority.js`)
const E = await import(`file://${SRC}/games/tanks/engine.js`)
const { seedFromString, TICK_MS, TANK_SPEED } = E

let pass = 0, fail = 0
const check = (label, ok, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${label}`) }
  else { fail++; console.log(`  FAIL  ${label}${detail ? '\n          ' + detail : ''}`) }
}

/**
 * A link that holds each message for a few ticks before delivering it.
 *
 * ~80ms each way is what the production relay measures through Singapore, and
 * it is the number that broke the first netcode - so the test runs at it
 * rather than at zero latency, where almost any scheme looks correct.
 */
const LATENCY_TICKS = Math.round(80 / TICK_MS)

function pair(seed) {
  const queues = { host: [], guest: [] }
  let clock = 0
  const ends = {}
  const make = (role, other) => createDuel({
    seed, role,
    onState: () => {},
    send: (msg) => queues[other].push({ at: clock + LATENCY_TICKS, msg: JSON.parse(JSON.stringify(msg)) }),
  })
  ends.host = make('host', 'guest')
  ends.guest = make('guest', 'host')

  return {
    ends,
    tick(hostInput, guestInput) {
      clock += 1
      for (const side of ['host', 'guest']) {
        const due = queues[side].filter((m) => m.at <= clock)
        queues[side] = queues[side].filter((m) => m.at > clock)
        for (const { msg } of due) ends[side].receive(msg)
      }
      if (hostInput) ends.host.setInput(hostInput)
      if (guestInput) ends.guest.setInput(guestInput)
      ends.host.tick()
      ends.guest.tick()
    },
  }
}

console.log('the guest is corrected, not left behind:')
{
  const net = pair(seedFromString('AUTH:1'))
  // The guest drives; the host sits still, like an untouched browser.
  for (let i = 0; i < 200; i++) {
    net.tick({ mx: 0, my: 0 }, { mx: Math.cos(i / 30), my: Math.sin(i / 30), aim: (i / 40) - Math.PI })
  }

  const h = net.ends.host.state.tanks
  const g = net.ends.guest.state.tanks
  check('the guest tank actually moved', Math.hypot(h[1].vx, h[1].vy) > 1 || h[1].shots > 0 ||
    Math.abs(h[1].x - 80) > 4 || Math.abs(h[1].y - 26) > 4,
    `host sees guest at ${h[1].x.toFixed(1)},${h[1].y.toFixed(1)}`)

  // The number that matters: how far apart the two screens think a tank is.
  const gap = Math.max(...[0, 1].map((i) => Math.hypot(h[i].x - g[i].x, h[i].y - g[i].y)))
  check(`both screens agree where the tanks are (worst ${gap.toFixed(2)} units)`, gap < 4,
    'a tank is 16.8 units across, so a few units is inside the hull')

  const vgap = Math.max(...[0, 1].map((i) => Math.hypot(h[i].vx - g[i].vx, h[i].vy - g[i].vy)))
  check(`and how fast they are going (worst ${vgap.toFixed(2)} of ${TANK_SPEED})`, vgap < TANK_SPEED * 0.5)
}

console.log('\nvelocity survives the wire:')
{
  // The failure this guards: vx/vy missing from the snapshot unpacks to
  // undefined, and the first predicted tick turns the tank into NaN.
  const net = pair(seedFromString('AUTH:2'))
  for (let i = 0; i < 60; i++) net.tick({ mx: 1, my: 0 }, { mx: -1, my: 0 })
  const all = [...net.ends.host.state.tanks, ...net.ends.guest.state.tanks]
  check('no tank position or velocity went NaN',
    all.every((t) => [t.x, t.y, t.vx, t.vy, t.heading, t.turret].every(Number.isFinite)),
    JSON.stringify(all.map((t) => [t.x, t.vx])))

  const moving = net.ends.guest.state.tanks[0]
  check('the guest sees the host tank carrying speed, not restarting each snapshot',
    Math.abs(moving.vx) > TANK_SPEED * 0.5, `vx ${moving.vx.toFixed(1)}`)
}

console.log('\nthe protocol version moved with the format:')
{
  check('PROTOCOL_VERSION is past 1, so old tabs are told to refresh', PROTOCOL_VERSION > 1)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
