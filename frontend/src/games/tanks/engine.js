// Explicit .js so this module can be imported by plain Node as well as Vite.
//
// The tank duel's rules, with no React and no DOM. Same shape as Snake's
// engine: a pure step() over a plain state object, so it can be driven from a
// test at any speed and inspected between ticks.
//
// One thing is deliberately different. Snake's engine forbids floats, because
// lockstep needed two machines to produce byte-identical results from the same
// inputs. This duel is host-authoritative - only the referee's simulation is
// real, and the other player is corrected towards it - so continuous positions,
// angles and reflections are all fine. That freedom is what makes aiming a
// skill rather than a choice between four directions.

/* ---- shape of the world ------------------------------------------------- */

/** Portrait, because that is the shape of the screen it is played on. */
export const ARENA = { cols: 8, rows: 11, cell: 20, w: 160, h: 220 }

/** 30Hz. Fast enough that steering feels continuous, slow enough that a
    snapshot per tick stays a few KB a second. */
export const TICK_MS = 33
const DT = TICK_MS / 1000

export const TANK_R = 7.2
export const TANK_SPEED = 46        // units per second
/** How fast the hull swings to face where it is going. Cosmetic only now. */
export const TURN_RATE = 7.5        // radians per second
export const RELOAD_MS = 850

/**
 * Shells travel; they are not hitscan.
 *
 * This is the design decision the whole game rests on. A shell crosses the
 * arena in about two seconds, so the ~160ms it takes a message to reach the
 * other player is invisible - by the time anything lands, both screens agree
 * where everyone is. A hitscan weapon at this latency would need rewind and
 * lag compensation to feel fair.
 */
export const SHELL_SPEED = 95
export const SHELL_R = 1.6
export const SHELL_LIFE_MS = 2600
/** One bounce. Enough for bank shots to be the point, few enough that a stray
    shell does not roam the arena for seconds. */
export const MAX_BOUNCES = 1

export const BLAST_R = 26

export const CELL = {
  EMPTY: 0,
  CRATE: 1,      // two hits
  CRATE_HIT: 2,  // one hit left
  STEEL: 3,      // permanent, shells bounce
  BARREL: 4,     // detonates, chains
}

/** Everything a shell cannot pass through. */
const SOLID = new Set([CELL.CRATE, CELL.CRATE_HIT, CELL.STEEL, CELL.BARREL])

export const EVENT = {
  BOUNCE: 'bounce',
  CRATE_HIT: 'crate-hit',
  CRATE_BREAK: 'crate-break',
  BLAST: 'blast',
  TANK_HIT: 'tank-hit',
  FIRE: 'fire',
}

/* ---- random ------------------------------------------------------------- */

function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function seedFromString(text) {
  let hash = 2166136261
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

/* ---- the arena ---------------------------------------------------------- */

const idx = (col, row) => row * ARENA.cols + col
/** Both tanks spawn on this column, and it is kept clear of steel. */
const SPAWN_COL = Math.floor(ARENA.cols / 2)
const inGrid = (col, row) => col >= 0 && col < ARENA.cols && row >= 0 && row < ARENA.rows

/**
 * A layout with 180-degree symmetry.
 *
 * Whatever cover one player gets, the other gets the same cover in the mirrored
 * position, so no seed can hand somebody a better spawn. Generating half and
 * rotating it is the cheapest way to guarantee that.
 */
export function buildArena(seed) {
  const rand = mulberry32(seed)
  const grid = new Array(ARENA.cols * ARENA.rows).fill(CELL.EMPTY)
  const half = Math.floor(ARENA.rows / 2)

  const place = (col, row, type) => {
    if (!inGrid(col, row)) return
    grid[idx(col, row)] = type
    // The mirrored twin, so both players face the same arena.
    grid[idx(ARENA.cols - 1 - col, ARENA.rows - 1 - row)] = type
  }

  for (let row = 1; row < half; row++) {
    for (let col = 1; col < ARENA.cols - 1; col++) {
      // Spawn corners stay clear, or a player can be boxed in at the start.
      if (row < 2 && (col < 3 || col > ARENA.cols - 4)) continue
      const roll = rand()
      // Steel is permanent, so it is the only thing that can seal a player in.
      // The spawn column is kept free of it for the whole height of the arena,
      // which guarantees the two halves are always connected. Crates there are
      // fine - they block the opening shot but can be shot away, so they delay
      // a route rather than removing it. Without this a quarter of seeds
      // produced an arena where no shell could ever reach the other player.
      const spine = col === SPAWN_COL
      if (roll < 0.10) place(col, row, spine ? CELL.CRATE : CELL.STEEL)
      else if (roll < 0.22) place(col, row, CELL.CRATE)
      else if (roll < 0.27) place(col, row, CELL.BARREL)
    }
  }

  // A steel divider across the middle, so the opening shot of a round is never
  // a straight line from one spawn to the other.
  //
  // Laid down through the same mirroring helper as everything else. Writing it
  // directly was a bug: the row it occupies is the mirror of the last row the
  // loop fills, so it overwrote that row's twin and broke the symmetry the
  // whole layout depends on. Its gaps are symmetric about the vertical centre
  // too, or a corridor would open on one side and be walled on the other.
  const GAPS = new Set([1, ARENA.cols - 2])
  for (let col = 0; col < ARENA.cols; col++) {
    if (GAPS.has(col)) continue
    // The spawn column gets a CRATE rather than steel or a hole. Steel there
    // would seal the halves apart; a hole is a straight lane from one spawn to
    // the other and the round opens with a free shot. A crate denies the shot
    // and can be cleared, so it delays the route instead of removing it.
    place(col, half - 1, col === SPAWN_COL ? CELL.CRATE : CELL.STEEL)
  }

  // Placed AFTER the divider, not before: the divider is laid down through the
  // same mirroring helper and was overwriting barrels that had already been
  // counted, so a seed could still end up with none.
  // Barrels are the most interesting thing on the board, and at a low spawn
  // chance some seeds produced none at all - an arena with nothing to blow up.
  // A floor guarantees a couple, placed through the mirror like everything else.
  let barrels = grid.filter((c) => c === CELL.BARREL).length
  for (let attempt = 0; attempt < 40 && barrels < 2; attempt++) {
    const col = 1 + Math.floor(rand() * (ARENA.cols - 2))
    const row = 2 + Math.floor(rand() * Math.max(1, half - 3))
    if (!inGrid(col, row) || grid[idx(col, row)] !== CELL.EMPTY) continue
    place(col, row, CELL.BARREL)
    barrels += 2
  }

  // Spawns are cleared last, so nothing placed above can bury a tank.
  const spawnRow = Math.floor((ARENA.h - 26) / ARENA.cell)
  place(SPAWN_COL, spawnRow, CELL.EMPTY)
  place(SPAWN_COL, ARENA.rows - 1 - spawnRow, CELL.EMPTY)

  return grid
}

/* ---- state -------------------------------------------------------------- */

function makeTank(id, x, y, heading) {
  return { id, x, y, heading, turret: heading, alive: true, cooldown: 0, shots: 0 }
}

export function createState(seed) {
  return {
    tick: 0,
    status: 'playing',
    seed,
    rngState: seed >>> 0,
    grid: buildArena(seed),
    tanks: [
      makeTank(0, ARENA.w * 0.5, ARENA.h - 26, -Math.PI / 2),
      makeTank(1, ARENA.w * 0.5, 26, Math.PI / 2),
    ],
    shells: [],
    nextShellId: 1,
    // Consumed by the renderer each tick to fire off effects. They ride along
    // in the snapshot so both screens play the same explosions.
    events: [],
    winner: null,
  }
}

/* ---- geometry ----------------------------------------------------------- */

const cellAt = (grid, x, y) => {
  const col = Math.floor(x / ARENA.cell)
  const row = Math.floor(y / ARENA.cell)
  if (!inGrid(col, row)) return { col, row, type: CELL.STEEL, outside: true }
  return { col, row, type: grid[idx(col, row)], outside: false }
}

/** Circle against the solid cells around it. Returns a corrected position. */
function slide(grid, x, y, r) {
  let nx = x
  let ny = y
  const c0 = Math.floor((x - r) / ARENA.cell)
  const c1 = Math.floor((x + r) / ARENA.cell)
  const r0 = Math.floor((y - r) / ARENA.cell)
  const r1 = Math.floor((y + r) / ARENA.cell)

  for (let row = r0; row <= r1; row++) {
    for (let col = c0; col <= c1; col++) {
      const solid = !inGrid(col, row) || SOLID.has(grid[idx(col, row)])
      if (!solid) continue
      const left = col * ARENA.cell
      const top = row * ARENA.cell
      const cx = Math.max(left, Math.min(nx, left + ARENA.cell))
      const cy = Math.max(top, Math.min(ny, top + ARENA.cell))
      let dx = nx - cx
      let dy = ny - cy
      const dist = Math.hypot(dx, dy)
      if (dist >= r) continue
      if (dist === 0) { dx = 0; dy = -1 }
      const push = (r - dist) || r
      const len = dist || 1
      nx += (dx / len) * push
      ny += (dy / len) * push
    }
  }
  // The arena edge is steel too, so the same rule applies at the boundary.
  nx = Math.max(r, Math.min(ARENA.w - r, nx))
  ny = Math.max(r, Math.min(ARENA.h - r, ny))
  return { x: nx, y: ny }
}

const blocked = (grid, x, y) => {
  const c = cellAt(grid, x, y)
  return c.outside || SOLID.has(c.type)
}

/* ---- damage ------------------------------------------------------------- */

function damageCell(state, col, row, events, depth = 0) {
  if (!inGrid(col, row)) return
  const type = state.grid[idx(col, row)]
  const x = (col + 0.5) * ARENA.cell
  const y = (row + 0.5) * ARENA.cell

  if (type === CELL.CRATE) {
    state.grid[idx(col, row)] = CELL.CRATE_HIT
    events.push({ e: EVENT.CRATE_HIT, x, y })
  } else if (type === CELL.CRATE_HIT) {
    state.grid[idx(col, row)] = CELL.EMPTY
    events.push({ e: EVENT.CRATE_BREAK, x, y })
  } else if (type === CELL.BARREL) {
    detonate(state, x, y, events, depth)
  }
}

/**
 * A barrel going up, taking its neighbourhood with it.
 *
 * Chains, but with a depth cap: a dense cluster of barrels could otherwise
 * recurse a long way in a single tick, and one lucky shot would clear half the
 * arena in one frame.
 */
function detonate(state, x, y, events, depth = 0) {
  const col = Math.floor(x / ARENA.cell)
  const row = Math.floor(y / ARENA.cell)
  if (inGrid(col, row)) state.grid[idx(col, row)] = CELL.EMPTY
  events.push({ e: EVENT.BLAST, x, y })
  if (depth > 3) return

  const reach = Math.ceil(BLAST_R / ARENA.cell)
  for (let r = row - reach; r <= row + reach; r++) {
    for (let c = col - reach; c <= col + reach; c++) {
      if (!inGrid(c, r) || (c === col && r === row)) continue
      const dx = (c + 0.5) * ARENA.cell - x
      const dy = (r + 0.5) * ARENA.cell - y
      if (Math.hypot(dx, dy) > BLAST_R) continue
      damageCell(state, c, r, events, depth + 1)
    }
  }
  for (const tank of state.tanks) {
    if (!tank.alive) continue
    if (Math.hypot(tank.x - x, tank.y - y) <= BLAST_R) {
      tank.alive = false
      events.push({ e: EVENT.TANK_HIT, x: tank.x, y: tank.y, id: tank.id, cause: 'blast' })
    }
  }
}

/* ---- the step ----------------------------------------------------------- */

/**
 * @param {object} state
 * @param {object} inputs seat -> { drive, steer, aim, fire }
 *   drive/steer are -1..1, aim is an absolute angle in radians, fire is a bool.
 */
export function step(state, inputs = {}) {
  if (state.status === 'over') return state

  const next = {
    ...state,
    tick: state.tick + 1,
    grid: state.grid.slice(),
    tanks: state.tanks.map((t) => ({ ...t })),
    shells: state.shells.map((s) => ({ ...s })),
    events: [],
  }
  const events = next.events

  /* tanks */
  for (const tank of next.tanks) {
    if (!tank.alive) continue
    const input = inputs[tank.id] ?? {}
    if (typeof input.aim === 'number') tank.turret = wrap(input.aim)

    // The tank goes where you push it. The first version steered and
    // throttled like a real tank, which reads as authentic and plays as
    // awkward - on a phone you spend the round fighting the turn rate instead
    // of the other player. The hull still swings round to face the direction
    // of travel, so it looks like a tank; it just no longer handles like one.
    let mx = clamp(input.mx ?? 0, -1, 1)
    let my = clamp(input.my ?? 0, -1, 1)
    const push = Math.hypot(mx, my)
    if (push > 1) { mx /= push; my /= push }

    if (push > 0.08) {
      const moved = slide(
        next.grid,
        tank.x + mx * TANK_SPEED * DT,
        tank.y + my * TANK_SPEED * DT,
        TANK_R
      )
      tank.x = moved.x
      tank.y = moved.y
      const want = Math.atan2(my, mx)
      const diff = wrap(want - tank.heading)
      const swing = TURN_RATE * DT
      tank.heading = wrap(tank.heading + clamp(diff, -swing, swing))
    }

    tank.cooldown = Math.max(0, tank.cooldown - TICK_MS)
    if (input.fire && tank.cooldown === 0) {
      tank.cooldown = RELOAD_MS
      tank.shots += 1
      const muzzle = TANK_R + SHELL_R + 1.6
      next.shells.push({
        id: next.nextShellId++,
        owner: tank.id,
        x: tank.x + Math.cos(tank.turret) * muzzle,
        y: tank.y + Math.sin(tank.turret) * muzzle,
        vx: Math.cos(tank.turret) * SHELL_SPEED,
        vy: Math.sin(tank.turret) * SHELL_SPEED,
        bounces: 0,
        life: SHELL_LIFE_MS,
      })
      events.push({ e: EVENT.FIRE, x: tank.x, y: tank.y, a: tank.turret, id: tank.id })
    }
  }

  /* shells */
  const surviving = []
  for (const shell of next.shells) {
    shell.life -= TICK_MS
    if (shell.life <= 0) continue

    let dead = false
    // Each axis is resolved on its own, which is what makes a corner behave
    // sensibly and keeps the reflection exact rather than approximate.
    for (const axis of ['x', 'y']) {
      const before = shell[axis]
      shell[axis] += shell[axis === 'x' ? 'vx' : 'vy'] * DT
      if (!blocked(next.grid, shell.x, shell.y)) continue

      const hit = cellAt(next.grid, shell.x, shell.y)
      if (!hit.outside && hit.type !== CELL.STEEL) {
        damageCell(next, hit.col, hit.row, events)
        dead = true
        break
      }
      // Steel, or the arena edge: reflect.
      shell[axis] = before
      if (axis === 'x') shell.vx = -shell.vx
      else shell.vy = -shell.vy
      shell.bounces += 1
      events.push({ e: EVENT.BOUNCE, x: shell.x, y: shell.y })
      if (shell.bounces > MAX_BOUNCES) { dead = true; break }
    }
    if (dead) continue

    for (const tank of next.tanks) {
      if (!tank.alive) continue
      // A shell cannot hit the tank that fired it until it has bounced, or
      // firing into a nearby wall would be suicide rather than a bank shot.
      if (tank.id === shell.owner && shell.bounces === 0) continue
      if (Math.hypot(tank.x - shell.x, tank.y - shell.y) <= TANK_R + SHELL_R) {
        tank.alive = false
        events.push({ e: EVENT.TANK_HIT, x: tank.x, y: tank.y, id: tank.id, by: shell.owner, bounces: shell.bounces })
        dead = true
        break
      }
    }
    if (!dead) surviving.push(shell)
  }
  next.shells = surviving

  const alive = next.tanks.filter((t) => t.alive)
  if (alive.length <= 1) {
    next.status = 'over'
    next.winner = alive.length === 1 ? alive[0].id : null
  }
  return next
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)
const wrap = (a) => {
  let r = a
  while (r > Math.PI) r -= Math.PI * 2
  while (r < -Math.PI) r += Math.PI * 2
  return r
}

/* ---- aiming -------------------------------------------------------------- */

/**
 * Where a shell fired from here would actually go.
 *
 * A walk of the SAME rules step() uses, not a closed-form ray cast, and it
 * takes the whole state rather than just the grid so it can stop on a tank and
 * expire on the same tick a real shell would. If the guide and the shell ever
 * disagreed, the game would be lying about the one thing it asks the player to
 * be good at - and the first version did, walking straight through the tank
 * that fired it on the way back from a wall.
 *
 * Returns the points of the path for the UI to draw as a polyline.
 */
export function predictShot(state, seat, angle, { maxBounces = MAX_BOUNCES } = {}) {
  const shooter = state.tanks[seat]
  if (!shooter) return []
  const muzzle = TANK_R + SHELL_R + 1.6
  let px = shooter.x + Math.cos(angle) * muzzle
  let py = shooter.y + Math.sin(angle) * muzzle
  let vx = Math.cos(angle) * SHELL_SPEED
  let vy = Math.sin(angle) * SHELL_SPEED
  let life = SHELL_LIFE_MS
  let bounces = 0

  const points = [{ x: px, y: py }]

  for (;;) {
    life -= TICK_MS
    if (life <= 0) { points.push({ x: px, y: py, end: 'spent' }); return points }

    let done = false
    for (const axis of ['x', 'y']) {
      const before = axis === 'x' ? px : py
      if (axis === 'x') px += vx * DT
      else py += vy * DT
      if (!blocked(state.grid, px, py)) continue

      const hit = cellAt(state.grid, px, py)
      if (!hit.outside && hit.type !== CELL.STEEL) {
        points.push({ x: px, y: py, end: 'break' })
        return points
      }
      if (axis === 'x') px = before
      else py = before
      points.push({ x: px, y: py, bounce: true })
      if (axis === 'x') vx = -vx
      else vy = -vy
      bounces += 1
      if (bounces > maxBounces) { done = true; break }
    }
    if (done) { points.push({ x: px, y: py, end: 'spent' }); return points }

    for (const tank of state.tanks) {
      if (!tank.alive) continue
      if (tank.id === seat && bounces === 0) continue
      if (Math.hypot(tank.x - px, tank.y - py) <= TANK_R + SHELL_R) {
        points.push({ x: px, y: py, end: 'hit', id: tank.id })
        return points
      }
    }
  }
}
