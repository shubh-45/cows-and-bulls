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
export const ARENA = { cols: 15, rows: 22, cell: 10, w: 150, h: 220 }

/** 30Hz. Fast enough that steering feels continuous, slow enough that a
    snapshot per tick stays a few KB a second. */
export const TICK_MS = 33
const DT = TICK_MS / 1000

export const TANK_R = 4.2
export const TANK_SPEED = 36        // units per second
export const TURN_RATE = 3.4        // radians per second
export const RELOAD_MS = 900

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
export const SHELL_R = 1.1
export const SHELL_LIFE_MS = 2600
/** One bounce. Enough for bank shots to be the point, few enough that a stray
    shell does not roam the arena for seconds. */
export const MAX_BOUNCES = 1

export const BLAST_R = 22

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

  for (let row = 2; row < half; row++) {
    for (let col = 1; col < ARENA.cols - 1; col++) {
      // Spawn corners stay clear, or a player can be boxed in at the start.
      if (row < 4 && (col < 4 || col > ARENA.cols - 5)) continue
      const roll = rand()
      // Steel is permanent, so it is the only thing that can seal a player in.
      // The spawn column is kept free of it for the whole height of the arena,
      // which guarantees the two halves are always connected. Crates there are
      // fine - they block the opening shot but can be shot away, so they delay
      // a route rather than removing it. Without this a quarter of seeds
      // produced an arena where no shell could ever reach the other player.
      const spine = col === SPAWN_COL
      if (roll < 0.13) place(col, row, spine ? CELL.CRATE : CELL.STEEL)
      else if (roll < 0.34) place(col, row, CELL.CRATE)
      else if (roll < 0.365) place(col, row, CELL.BARREL)
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
  const GAPS = new Set([1, SPAWN_COL, ARENA.cols - 2])
  for (let col = 0; col < ARENA.cols; col++) {
    if (GAPS.has(col)) continue
    place(col, half - 1, CELL.STEEL)
  }
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
      makeTank(0, ARENA.w * 0.5, ARENA.h - 22, -Math.PI / 2),
      makeTank(1, ARENA.w * 0.5, 22, Math.PI / 2),
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
    const steer = clamp(input.steer ?? 0, -1, 1)
    const drive = clamp(input.drive ?? 0, -1, 1)

    tank.heading = wrap(tank.heading + steer * TURN_RATE * DT)
    if (typeof input.aim === 'number') tank.turret = wrap(input.aim)

    if (drive !== 0) {
      const speed = TANK_SPEED * drive * DT
      const moved = slide(
        next.grid,
        tank.x + Math.cos(tank.heading) * speed,
        tank.y + Math.sin(tank.heading) * speed,
        TANK_R
      )
      tank.x = moved.x
      tank.y = moved.y
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
