// The tank duel's rules, checked headlessly. Aiming is the game, so the
// ricochet geometry gets the most attention.
const T = new URL('../src/games/tanks', import.meta.url).pathname
const E = await import(`file://${T}/engine.js`)
const { ARENA, CELL, EVENT, TICK_MS, createState, step, buildArena, seedFromString } = E

let pass = 0, fail = 0
const check = (label, ok, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${label}`) }
  else { fail++; console.log(`  FAIL  ${label}${detail ? '\n          ' + detail : ''}`) }
}
const idx = (c, r) => r * ARENA.cols + c
/** A bare arena, so a test controls exactly what is in it. */
function empty(seed = 1) {
  const s = createState(seed)
  s.grid = new Array(ARENA.cols * ARENA.rows).fill(CELL.EMPTY)
  s.shells = []
  return s
}
/**
 * Moves the other tank out of the line of fire.
 *
 * Killing it - the obvious way to isolate a test - ends the round, and step()
 * returns the state untouched from then on, so every assertion afterwards was
 * really testing a frozen world.
 */
function park(s, x = 12, y = 12) {
  s.tanks[1] = { ...s.tanks[1], x, y, alive: true }
  return s
}
const run = (s, inputs, ticks) => { let st = s; for (let i = 0; i < ticks; i++) st = step(st, inputs); return st }
const evs = (st, kind) => st.events.filter((e) => e.e === kind)

console.log('arena:')
{
  const g = buildArena(seedFromString('SYM:1'))
  let symmetric = true
  for (let r = 0; r < ARENA.rows; r++)
    for (let c = 0; c < ARENA.cols; c++)
      if (g[idx(c, r)] !== g[idx(ARENA.cols - 1 - c, ARENA.rows - 1 - r)]) symmetric = false
  check('layout has 180-degree symmetry, so neither spawn is favoured', symmetric)

  const s = createState(seedFromString('SPAWN:1'))
  const clear = s.tanks.every((t) => {
    const col = Math.floor(t.x / ARENA.cell), row = Math.floor(t.y / ARENA.cell)
    return s.grid[idx(col, row)] === CELL.EMPTY
  })
  check('both tanks spawn on empty ground', clear)
}

{
  // The failure this catches is brutal and silent: a layout where steel walls
  // the two halves apart can never end, because a shell cannot pass steel
  // either. A quarter of seeds did exactly that before the spawn column was
  // kept clear.
  const SOLIDS = new Set([CELL.CRATE, CELL.CRATE_HIT, CELL.STEEL, CELL.BARREL])
  const reach = (grid, from, to, blocking) => {
    const seen = new Set([from.r * ARENA.cols + from.c])
    const q = [from]
    while (q.length) {
      const { c, r } = q.shift()
      if (c === to.c && r === to.r) return true
      for (const [dc, dr] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const nc = c + dc, nr = r + dr
        if (nc < 0 || nc >= ARENA.cols || nr < 0 || nr >= ARENA.rows) continue
        const k = nr * ARENA.cols + nc
        if (seen.has(k) || blocking.has(grid[k])) continue
        seen.add(k); q.push({ c: nc, r: nr })
      }
    }
    return false
  }
  let sealed = 0, noOpenShot = 0
  const N = 300
  for (let i = 1; i <= N; i++) {
    const st = createState((i * 2654435761) % 4294967296)
    const a = { c: Math.floor(st.tanks[0].x / ARENA.cell), r: Math.floor(st.tanks[0].y / ARENA.cell) }
    const b = { c: Math.floor(st.tanks[1].x / ARENA.cell), r: Math.floor(st.tanks[1].y / ARENA.cell) }
    if (!reach(st.grid, a, b, new Set([CELL.STEEL]))) sealed++
    if (!reach(st.grid, a, b, SOLIDS)) noOpenShot++
  }
  check(`no seed walls the two halves apart permanently (${N} seeds)`, sealed === 0, `${sealed} sealed`)
  // "A route exists" is not the same claim as "there is a straight shot", and
  // conflating them made this assert the opposite of what is wanted: a winding
  // route between the halves is exactly the point. What must never exist is a
  // clear LINE between the two spawns on the opening tick.
  let straightShots = 0
  for (let i = 1; i <= N; i++) {
    const st = createState((i * 2654435761) % 4294967296)
    const a = st.tanks[0], b = st.tanks[1]
    let clear = true
    const steps = 400
    for (let k = 1; k < steps; k++) {
      const x = a.x + ((b.x - a.x) * k) / steps
      const y = a.y + ((b.y - a.y) * k) / steps
      const cell = st.grid[Math.floor(y / ARENA.cell) * ARENA.cols + Math.floor(x / ARENA.cell)]
      if (cell !== CELL.EMPTY) { clear = false; break }
    }
    if (clear) straightShots++
  }
  check(`no seed opens with a clear line between the spawns (${straightShots}/${N} had one)`,
    straightShots === 0)
}

console.log('\ndriving:')
{
  let s = empty()
  const before = { ...s.tanks[0] }
  s = run(s, { 0: { mx: 1, my: 0 } }, 30)          // ~1 second right
  const moved = Math.hypot(s.tanks[0].x - before.x, s.tanks[0].y - before.y)
  check(`moves at about ${E.TANK_SPEED} units a second (moved ${moved.toFixed(1)})`,
    Math.abs(moved - E.TANK_SPEED) < 4)

  // Push and go, rather than steer and throttle: pushing straight down must
  // move the tank straight down whatever way it happens to be facing.
  let d = empty()
  d.tanks[0] = { ...d.tanks[0], x: 80, y: 110, heading: Math.PI }
  d = run(d, { 0: { mx: 0, my: 1 } }, 20)
  check('goes the way you push, regardless of which way it was facing',
    Math.abs(d.tanks[0].x - 80) < 0.5 && d.tanks[0].y > 110 + 20)

  let h = empty()
  h.tanks[0] = { ...h.tanks[0], x: 80, y: 110, heading: Math.PI }
  h = run(h, { 0: { mx: 1, my: 0 } }, 20)
  check('and the hull swings round to face where it is going',
    Math.abs(h.tanks[0].heading) < 0.35, `heading ${h.tanks[0].heading.toFixed(2)}`)

  // A diagonal must not be faster than a straight line.
  let diag = empty()
  diag.tanks[0] = { ...diag.tanks[0], x: 40, y: 60 }
  const p0 = { ...diag.tanks[0] }
  diag = run(diag, { 0: { mx: 1, my: 1 } }, 30)
  const diagMoved = Math.hypot(diag.tanks[0].x - p0.x, diag.tanks[0].y - p0.y)
  check(`diagonals are not faster (${diagMoved.toFixed(1)} vs ${E.TANK_SPEED})`,
    Math.abs(diagMoved - E.TANK_SPEED) < 4)

  let w = empty()
  w.tanks[0] = { ...w.tanks[0], x: 30, y: 30 }
  w = run(w, { 0: { mx: -1, my: 0 } }, 60)
  check(`stopped by the arena edge (x=${w.tanks[0].x.toFixed(1)})`, w.tanks[0].x >= E.TANK_R - 0.01)

  let b = empty()
  b.grid[idx(2, 5)] = CELL.STEEL
  b.tanks[0] = { ...b.tanks[0], x: 120, y: 110 }
  b = run(b, { 0: { mx: -1, my: 0 } }, 60)
  const blockRight = 3 * ARENA.cell
  check(`stopped by a steel block (x=${b.tanks[0].x.toFixed(1)}, block ends at ${blockRight})`,
    b.tanks[0].x >= blockRight + E.TANK_R - 0.8)
}

console.log('\nfiring:')
{
  let s = empty()
  s.tanks[0] = { ...s.tanks[0], x: 80, y: 110, turret: 0 }
  s = step(s, { 0: { fire: true } })
  check('firing spawns exactly one shell', s.shells.length === 1)
  check('shell leaves in the turret direction, not the hull direction',
    s.shells[0].vx > 90 && Math.abs(s.shells[0].vy) < 1)
  check('a fire event is emitted for the muzzle flash', evs(s, EVENT.FIRE).length === 1)

  const after = step(s, { 0: { fire: true } })
  check('reload blocks a second shot', after.shells.length === 1)

  let r = s
  for (let i = 0; i < Math.ceil(E.RELOAD_MS / TICK_MS) + 1; i++) r = step(r, {})
  r = step(r, { 0: { fire: true } })
  check(`can fire again after ${E.RELOAD_MS}ms`, r.tanks[0].shots === 2)
}

console.log('\nricochet:')
{
  // Straight at the right wall: should come back along the same line.
  let s = empty()
  s.tanks[0] = { ...s.tanks[0], x: 80, y: 110, turret: 0 }
  park(s)
  s = step(s, { 0: { fire: true } })
  const vx0 = s.shells[0].vx
  let bounced = null
  for (let i = 0; i < 60 && !bounced; i++) {
    s = step(s, {})
    if (evs(s, EVENT.BOUNCE).length) bounced = s.shells[0]
  }
  check('shell bounces off the arena edge', Boolean(bounced))
  check('reflection reverses the axis it struck, exactly',
    bounced && Math.abs(bounced.vx + vx0) < 1e-9 && Math.abs(bounced.vy) < 1e-9,
    bounced ? `vx ${bounced.vx.toFixed(2)} was ${vx0.toFixed(2)}` : '')

  // A 45-degree shot must leave at 45 degrees the other way: speed preserved,
  // angle mirrored. This is the property the aim guide has to predict.
  let d = empty()
  d.tanks[0] = { ...d.tanks[0], x: 80, y: 110, turret: -Math.PI / 4 }
  park(d)
  d = step(d, { 0: { fire: true } })
  const speed0 = Math.hypot(d.shells[0].vx, d.shells[0].vy)
  let after = null
  for (let i = 0; i < 90 && !after; i++) {
    d = step(d, {})
    if (evs(d, EVENT.BOUNCE).length) after = d.shells[0]
  }
  check('a 45-degree bank keeps its speed', after && Math.abs(Math.hypot(after.vx, after.vy) - speed0) < 1e-9)
  check('and mirrors the angle', after && Math.abs(Math.abs(after.vx) - Math.abs(after.vy)) < 1e-9)

  let m = empty()
  m.tanks[0] = { ...m.tanks[0], x: 80, y: 110, turret: 0 }
  park(m)
  m = step(m, { 0: { fire: true } })
  let seen = 0
  for (let i = 0; i < 300; i++) { m = step(m, {}); seen += evs(m, EVENT.BOUNCE).length; if (!m.shells.length) break }
  check(`a shell dies after ${E.MAX_BOUNCES} bounce, not forever (saw ${seen})`,
    m.shells.length === 0 && seen <= E.MAX_BOUNCES + 1)
}

console.log('\ncover:')
{
  let s = empty()
  s.grid[idx(4, 5)] = CELL.CRATE
  s.tanks[0] = { ...s.tanks[0], x: 90, y: 150, turret: -Math.PI / 2 }
  park(s)
  s = step(s, { 0: { fire: true } })
  let firstHit = false
  for (let i = 0; i < 60 && !firstHit; i++) { s = step(s, {}); if (evs(s, EVENT.CRATE_HIT).length) firstHit = true }
  check('first shell cracks a crate rather than destroying it',
    firstHit && s.grid[idx(4, 5)] === CELL.CRATE_HIT)
  check('and the shell is consumed', s.shells.length === 0)

  s.tanks[0].cooldown = 0
  s = step(s, { 0: { fire: true } })
  let broke = false
  for (let i = 0; i < 60 && !broke; i++) { s = step(s, {}); if (evs(s, EVENT.CRATE_BREAK).length) broke = true }
  check('second shell destroys it and opens the lane',
    broke && s.grid[idx(4, 5)] === CELL.EMPTY)

  let st = empty()
  st.grid[idx(4, 5)] = CELL.STEEL
  st.tanks[0] = { ...st.tanks[0], x: 90, y: 150, turret: -Math.PI / 2 }
  park(st)
  st = step(st, { 0: { fire: true } })
  for (let i = 0; i < 40; i++) st = step(st, {})
  check('steel is never damaged, only deflects', st.grid[idx(4, 5)] === CELL.STEEL)
}

console.log('\nbarrels:')
{
  let s = empty()
  s.grid[idx(4, 5)] = CELL.BARREL
  s.grid[idx(5, 5)] = CELL.CRATE      // inside the blast
  s.grid[idx(3, 5)] = CELL.BARREL     // should chain
  s.tanks[0] = { ...s.tanks[0], x: 90, y: 150, turret: -Math.PI / 2 }
  park(s)
  s = step(s, { 0: { fire: true } })
  let blasts = 0
  for (let i = 0; i < 60 && blasts === 0; i++) { s = step(s, {}); blasts = evs(s, EVENT.BLAST).length }
  check(`hitting a barrel detonates it and chains the neighbour (${blasts} blasts)`, blasts >= 2)
  check('the struck barrel is gone', s.grid[idx(4, 5)] === CELL.EMPTY)
  check('the neighbouring barrel went too', s.grid[idx(3, 5)] === CELL.EMPTY)
  check('a crate inside the radius took damage', s.grid[idx(5, 5)] !== CELL.CRATE)

  let k = empty()
  k.grid[idx(4, 5)] = CELL.BARREL
  k.tanks[1] = { ...k.tanks[1], x: 90, y: 108, alive: true }   // stood next to it
  k.tanks[0] = { ...k.tanks[0], x: 90, y: 190, turret: -Math.PI / 2 }
  k = step(k, { 0: { fire: true } })
  for (let i = 0; i < 60 && k.status !== 'over'; i++) k = step(k, {})
  check('a blast kills a tank caught in it', k.status === 'over' && k.winner === 0)
}

console.log('\nhits and rounds:')
{
  let s = empty()
  s.tanks[0] = { ...s.tanks[0], x: 90, y: 190, turret: -Math.PI / 2 }
  s.tanks[1] = { ...s.tanks[1], x: 90, y: 90 }
  s = step(s, { 0: { fire: true } })
  for (let i = 0; i < 90 && s.status !== 'over'; i++) s = step(s, {})
  check('a direct hit ends the round', s.status === 'over')
  check('and the shooter wins it', s.winner === 0)

  let own = empty()
  own.tanks[0] = { ...own.tanks[0], x: 80, y: 110, turret: 0 }
  park(own)
  own = step(own, { 0: { fire: true } })
  for (let i = 0; i < 6; i++) own = step(own, {})
  check('you cannot shoot yourself point blank', own.tanks[0].alive)

  let bank = empty()
  bank.tanks[0] = { ...bank.tanks[0], x: 148, y: 110, turret: 0 }   // fire into the near wall
  park(bank)
  bank = step(bank, { 0: { fire: true } })
  let hitSelf = false
  for (let i = 0; i < 90 && !hitSelf; i++) { bank = step(bank, {}); hitSelf = !bank.tanks[0].alive }
  check('but a shell that has bounced can come back and kill you', hitSelf)
}

console.log('\naim guide:')
{
  // The guide is the game's promise to the player. It must not merely look
  // plausible - it must end where the shell ends, for the same reason.
  let base = empty(31)
  base.grid[idx(2, 8)] = CELL.CRATE
  base.grid[idx(6, 4)] = CELL.STEEL

  let worstGap = 0, outcomeMismatch = 0, tested = 0
  const oneTick = E.SHELL_SPEED * (TICK_MS / 1000)

  for (let i = 0; i < 48; i++) {
    const angle = -Math.PI + (i / 48) * Math.PI * 2
    let t = { ...base, tanks: base.tanks.map((k) => ({ ...k })), shells: [] }
    t.tanks[0] = { ...t.tanks[0], x: 80, y: 150, turret: angle, cooldown: 0 }
    t.tanks[1] = { ...t.tanks[1], x: 45, y: 60, alive: true }

    const path = E.predictShot(t, 0, angle)
    const predicted = path[path.length - 1]

    t = step(t, { 0: { fire: true } })
    let last = t.shells[0]
    let actual = 'spent'
    for (let n = 0; n < 300; n++) {
      const before = t.shells[0]
      t = step(t, {})
      if (t.shells[0]) { last = t.shells[0]; continue }
      // The tick it vanished: what ended it?
      if (t.events.some((e) => e.e === EVENT.TANK_HIT)) actual = 'hit'
      else if (t.events.some((e) => e.e === EVENT.CRATE_HIT || e.e === EVENT.CRATE_BREAK || e.e === EVENT.BLAST)) actual = 'break'
      if (before) last = before
      break
    }
    tested++
    if ((predicted.end ?? 'spent') !== actual) outcomeMismatch++
    worstGap = Math.max(worstGap, Math.hypot(last.x - predicted.x, last.y - predicted.y))
  }

  check(`guide predicts the right outcome at every angle (${tested} tested)`, outcomeMismatch === 0,
    `${outcomeMismatch} disagreed`)
  // One tick of travel is the floor here: the shell is gone from the array on
  // the tick it dies, so the last position readable from outside is a tick old.
  check(`and ends where the shell ends, within one tick of travel (${worstGap.toFixed(2)} vs ${oneTick.toFixed(2)})`,
    worstGap <= oneTick + 0.01)
}

console.log('\npurity:')
{
  const a = empty(99)
  const snapshot = JSON.stringify(a)
  step(a, { 0: { mx: 1, my: 0, fire: true } })
  check('step() does not mutate the state it was given', JSON.stringify(a) === snapshot)

  const s1 = createState(4242)
  const s2 = createState(4242)
  let x1 = s1, x2 = s2
  for (let i = 0; i < 120; i++) {
    const input = { 0: { mx: Math.sin(i / 9), my: 0.4, fire: i % 31 === 0 }, 1: { mx: -0.5, my: -1 } }
    x1 = step(x1, input); x2 = step(x2, input)
  }
  check('same seed and inputs give the same result', JSON.stringify(x1) === JSON.stringify(x2))
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
