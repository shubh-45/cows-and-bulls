// The guest's screen, which is what the recording showed misbehaving.
//
// The referee draws off its own clock and looked flawless. The guest drew off
// packet arrivals, so jitter became stutter and a corrective snapshot restarted
// the glide mid-cell - a hitch landing exactly on turns.

const SNAKE = new URL('../src/games/snake', import.meta.url).pathname
const { createDuel, TICK_MS, PROTOCOL_VERSION } = await import(`file://${SNAKE}/authority.js`)

let pass = 0, fail = 0
const check = (label, ok, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${label}`) }
  else { fail++; console.log(`  FAIL  ${label}${detail ? '\n          ' + detail : ''}`) }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function guestOnly() {
  const sent = []
  const guest = createDuel({ seed: 12345, role: 'guest', onState: () => {}, send: (m) => sent.push(m) })
  return { guest, sent }
}
// A snapshot as the referee would send it: reuse a real state and stamp a tick.
function snapshotAt(tick, base) {
  return { k: 's', v: PROTOCOL_VERSION, t: tick, s: { ...base, tick } }
}

console.log(`TICK_MS=${TICK_MS}\n`)

/* ---- 1. a match that has not started is not a connection problem ---- */
console.log('match start:')
{
  const { guest } = guestOnly()
  await sleep(120)
  check('no "waiting" warning before the referee has started',
    guest.silentFor() === 0, `silentFor=${Math.round(guest.silentFor())}ms`)
  guest.receive(snapshotAt(1, guest.state))
  await sleep(120)
  check('the silence clock runs once the match is under way',
    guest.silentFor() > 0)
}

/* ---- 2. a corrective snapshot must not restart the glide ---- */
console.log('\ncorrection on a turn:')
{
  const { guest } = guestOnly()
  guest.receive(snapshotAt(5, guest.state))
  await sleep(90)                                  // part-way through the cell
  const before = guest.progress()
  // The referee redid history for a late turn and re-sent the SAME tick.
  guest.receive(snapshotAt(5, guest.state))
  const after = guest.progress()
  check(`glide kept its place through the correction (${before.toFixed(2)} -> ${after.toFixed(2)})`,
    Math.abs(after - before) < 0.02,
    'a reset here is the hitch felt on every turn')
}

/* ---- 3. jitter must not become stutter ---- */
console.log('\njitter absorption:')
{
  const { guest } = guestOnly()
  guest.receive(snapshotAt(1, guest.state))
  // Snapshots arriving early/late by up to +-60ms, as a mobile link does.
  const wobble = [-55, 40, -30, 60, -45, 25, -60, 50]
  const starts = []
  let tick = 1
  for (const w of wobble) {
    await sleep(Math.max(10, TICK_MS + w))
    tick += 1
    guest.receive(snapshotAt(tick, guest.state))
    starts.push(guest.progress())
  }
  // With a packet-driven clock every arrival forces progress to 0. A clock that
  // eases towards the cadence keeps the glide roughly continuous instead.
  const allZero = starts.every((p) => p === 0)
  check('the glide is not slammed back to zero by every packet', !allZero,
    `progress right after each arrival: ${starts.map((p) => p.toFixed(2)).join(' ')}`)
}

/* ---- 4. the referee going quiet makes the guest hold, not run away ---- */
console.log('\nreferee goes quiet:')
{
  const { guest } = guestOnly()
  guest.receive(snapshotAt(1, guest.state))
  const authTick = 1
  // Tick hard with nothing arriving. The guest predicts a little way ahead and
  // then waits: predicting further would only build up a correction to pay for.
  for (let i = 0; i < 40; i++) guest.tick()
  const lead = guest.state.tick - authTick
  check(`held a short lead instead of predicting indefinitely (lead ${lead})`,
    lead > 0 && lead <= 3, `drew tick ${guest.state.tick} against truth ${authTick}`)

  // And it resumes the moment the referee speaks again.
  guest.receive(snapshotAt(20, guest.state))
  guest.tick()
  check('catches up to the referee once it speaks again',
    guest.state.tick >= 20, `drew tick ${guest.state.tick}`)
}

/* ---- 4b. progress never leaves 0..1 ---- */
console.log('\nprogress invariant:')
{
  const { guest } = guestOnly()
  let worst = null
  let tick = 0
  // Deliberately nasty: early, late, duplicate and same-tick corrections.
  for (const gap of [0, 300, 5, 220, 10, 400, 5, 150, 0, 30]) {
    await sleep(gap)
    if (gap % 3 === 0) tick += 1              // sometimes a correction, not a new tick
    guest.receive(snapshotAt(tick, guest.state))
    for (const extra of [0, 40, 120]) {
      await sleep(extra ? 40 : 0)
      const p = guest.progress()
      if (p < 0 || p > 1) worst = p
    }
  }
  check('progress stayed within 0..1 through early, late and duplicate packets',
    worst === null, `saw ${worst}`)
}

/* ---- 5. the guest's own turn still reads instantly ---- */
console.log('\nlocal responsiveness:')
{
  const { guest, sent } = guestOnly()
  guest.receive(snapshotAt(1, guest.state))
  const wasDir = guest.state.snakes[1].dir
  guest.steer('down')
  check('own turn shows on the next drawn tick without a round trip',
    guest.peekNext()?.snakes[1].dir === 'down', `was ${wasDir}`)
  check('and it was sent, tagged for the next tick',
    sent.some((m) => m.k === 'u' && m.d === 'down' && m.t === 2),
    JSON.stringify(sent))
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
