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

/** Sized against the 20-unit cell: a tank is most of a corridor, not a dot in
    it. The art in Board.jsx is scaled from this, so the thing you see and the
    thing that gets hit are the same size by construction. */
export const TANK_R = 8.4
export const TANK_SPEED = 33        // units per second, flat out

/**
 * The tank has weight.
 *
 * Speed alone does not read as heavy - a slow tank that starts and stops on the
 * same tick just feels sluggish. What reads as heavy is taking time to get
 * going and carrying on a little after you let go, so a turn has to be planned
 * one tank-length early. These are the two rates that do that, and they are
 * deliberately NOT a return to steer-and-throttle: you still push the tank
 * where you want it, it just does not answer instantly.
 */
export const TANK_ACCEL = 78        // units per second squared, under power
export const TANK_BRAKE = 62        // and coasting down, slower - it is heavy
/** How fast the hull swings to face where it is going. Cosmetic only. */
export const TURN_RATE = 4.2        // radians per second
/**
 * Turret traverse. The gun no longer snaps to wherever you point: it swings.
 * A half-turn takes about 0.8s, which is what makes a bank shot something you
 * line up rather than something you flick to. The aim guide is drawn from the
 * turret's REAL angle, so it shows the gun catching up rather than lying about
 * where a shot fired this instant would go.
 */
export const TURRET_RATE = 4.0      // radians per second
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
/** Where the tanks start. Shared with createState, so the cells the generator
    clears and the cells a tank actually occupies cannot drift apart. */
const SPAWNS = [
  { x: ARENA.w * 0.5, y: ARENA.h - 26, heading: -Math.PI / 2 },
  { x: ARENA.w * 0.5, y: 26, heading: Math.PI / 2 },
]
/** Cover cells, off the divider, that every seed is guaranteed. */
const MIN_COVER = 6
/** Kept clear for the full height of the arena, with its mirror, so a tank can
    always get from one half to the other. See buildArena. */
const LANE_COL = 1
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
      if (roll < 0.06) place(col, row, spine ? CELL.CRATE : CELL.STEEL)
      else if (roll < 0.14) place(col, row, CELL.CRATE)
      else if (roll < 0.18) place(col, row, CELL.BARREL)
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
  //
  // Two cells wide, not one. A tank is now 16.8 units across in a 20-unit
  // cell, so a single-cell gap left 1.6 units of clearance either side - a
  // doorway you had to line up on, with a tank that no longer stops on a
  // penny. Widening it is the same change as thinning the field: less of the
  // arena is wall. The set stays symmetric under col -> cols-1-col, or a
  // corridor would open on one side and be bricked up on the other.
  const GAPS = new Set([1, 2, ARENA.cols - 3, ARENA.cols - 2])
  for (let col = 0; col < ARENA.cols; col++) {
    if (GAPS.has(col)) continue
    // The spawn column gets a CRATE rather than steel or a hole. Steel there
    // would seal the halves apart; a hole is a straight lane from one spawn to
    // the other and the round opens with a free shot. A crate denies the shot
    // and can be cleared, so it delays the route instead of removing it.
    place(col, half - 1, col === SPAWN_COL ? CELL.CRATE : CELL.STEEL)
  }

  // One lane the generator is never allowed to brick up.
  //
  // The divider gaps alone are not a guarantee. Random cover lands in the rows
  // either side of them, and a single crate sitting under a gap walls off the
  // approach even though the gap itself is open - 5 seeds in 300 sealed a tank
  // into its own half that way, and a tank is now wide enough that it takes
  // only one. Rather than search the arena for a route and re-roll, one column
  // is cleared top to bottom: with the outermost rows never filled, that is a
  // route from either spawn, out along the back wall, up the lane and back.
  // It is a fallback, not the way you would choose to go - the two-cell
  // divider gaps are still the good route when they are open.
  //
  // Mirrored like everything else, so clearing column 1 clears column 6 too.
  for (let row = 0; row < ARENA.rows; row++) place(LANE_COL, row, CELL.EMPTY)

  // Spawns are cleared BEFORE the floors below count anything, which is the
  // opposite of what it used to do. Clearing them last reads as the safe
  // order and quietly undid the barrel floor: a barrel pair landing on a
  // spawn cell was counted as cover, then wiped by the clearing, and the seed
  // ended up with nothing to blow up after all. 29 seeds in 600 did exactly
  // that. Anything a floor places afterwards is well clear of a spawn, so
  // nothing can bury a tank either.
  //
  // The whole tank FOOTPRINT is cleared, not the single cell under its
  // centre. A tank spawns on a cell boundary and is now 16.8 units across on
  // a 20-unit grid, so it covers four cells; derived from TANK_R rather than
  // written out, so the next time the tank changes size this follows.
  for (const spawn of SPAWNS) {
    const c0 = Math.floor((spawn.x - TANK_R) / ARENA.cell)
    const c1 = Math.floor((spawn.x + TANK_R) / ARENA.cell)
    const r0 = Math.floor((spawn.y - TANK_R) / ARENA.cell)
    const r1 = Math.floor((spawn.y + TANK_R) / ARENA.cell)
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) place(col, row, CELL.EMPTY)
    }
  }

  // Barrels are the most interesting thing on the board, and at a low spawn
  // chance some seeds produced none at all - an arena with nothing to blow up.
  // A floor guarantees a couple, placed through the mirror like everything
  // else. The rows it draws from sit clear of both spawn footprints.
  // Stops one short of the divider row, and starts one below the spawn row.
  // Reaching the divider let the cover floor place a crate INTO the divider
  // and count it, so a bare seed satisfied the floor without gaining any
  // cover; starting on the spawn row would bury the mirrored tank.
  const FLOOR_ROW_LO = 2
  const FLOOR_ROW_HI = half - 2
  // Draws from the columns between the lanes, so a floor can never brick up
  // the one route the generator promises.
  const floorCell = () => ({
    col: LANE_COL + 1 + Math.floor(rand() * (ARENA.cols - 2 * (LANE_COL + 1))),
    row: FLOOR_ROW_LO + Math.floor(rand() * Math.max(1, FLOOR_ROW_HI - FLOOR_ROW_LO + 1)),
  })

  let barrels = grid.filter((c) => c === CELL.BARREL).length
  for (let attempt = 0; attempt < 40 && barrels < 2; attempt++) {
    const { col, row } = floorCell()
    if (!inGrid(col, row) || grid[idx(col, row)] !== CELL.EMPTY) continue
    place(col, row, CELL.BARREL)
    barrels += 2
  }

  // A floor on cover as well as on barrels.
  //
  // Thinning the field is what was asked for, but thinning it by probability
  // alone has a tail: a fifth of seeds came out with almost nothing between
  // the two tanks but the divider, and an open arena with slower tanks in it
  // is a shooting gallery rather than a duel. Counted off the divider rows,
  // because the divider is cover nobody chose.
  const isDivider = (row) => row === half - 1 || row === ARENA.rows - half
  const coverCount = () => {
    let n = 0
    for (let row = 0; row < ARENA.rows; row++) {
      if (isDivider(row)) continue
      for (let col = 0; col < ARENA.cols; col++) {
        if (grid[idx(col, row)] !== CELL.EMPTY) n += 1
      }
    }
    return n
  }
  let cover = coverCount()
  for (let attempt = 0; attempt < 60 && cover < MIN_COVER; attempt++) {
    const { col, row } = floorCell()
    if (!inGrid(col, row) || grid[idx(col, row)] !== CELL.EMPTY) continue
    place(col, row, CELL.CRATE)
    cover += 2
  }

  return grid
}

/* ---- state -------------------------------------------------------------- */

function makeTank(id, x, y, heading) {
  return { id, x, y, vx: 0, vy: 0, heading, turret: heading, alive: true, cooldown: 0, shots: 0 }
}

export function createState(seed) {
  return {
    tick: 0,
    status: 'playing',
    seed,
    rngState: seed >>> 0,
    grid: buildArena(seed),
    tanks: SPAWNS.map((s, i) => makeTank(i, s.x, s.y, s.heading)),
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

    // The gun traverses towards where you are pointing instead of snapping to
    // it, so aiming is a thing the tank does rather than a number you set.
    if (typeof input.aim === 'number') {
      const diff = wrap(wrap(input.aim) - tank.turret)
      const swing = TURRET_RATE * DT
      tank.turret = wrap(tank.turret + clamp(diff, -swing, swing))
    }

    // The tank goes where you push it. The first version steered and
    // throttled like a real tank, which reads as authentic and plays as
    // awkward - on a phone you spend the round fighting the turn rate instead
    // of the other player. The hull still swings round to face the direction
    // of travel, so it looks like a tank; it just no longer handles like one.
    //
    // What it does now have is inertia: the push sets a TARGET velocity, and
    // the tank accelerates towards it. Let go and it coasts to a stop. That is
    // the weight, and it costs one vector of state rather than a control
    // scheme nobody enjoyed.
    let mx = clamp(input.mx ?? 0, -1, 1)
    let my = clamp(input.my ?? 0, -1, 1)
    const push = Math.hypot(mx, my)
    if (push > 1) { mx /= push; my /= push }
    const driving = push > 0.08

    const wantVx = driving ? mx * TANK_SPEED : 0
    const wantVy = driving ? my * TANK_SPEED : 0
    let dvx = wantVx - tank.vx
    let dvy = wantVy - tank.vy
    const dv = Math.hypot(dvx, dvy)
    const most = (driving ? TANK_ACCEL : TANK_BRAKE) * DT
    if (dv > most) { dvx = (dvx / dv) * most; dvy = (dvy / dv) * most }
    tank.vx += dvx
    tank.vy += dvy

    if (Math.hypot(tank.vx, tank.vy) > 0.4) {
      const moved = slide(
        next.grid,
        tank.x + tank.vx * DT,
        tank.y + tank.vy * DT,
        TANK_R
      )
      // Velocity is re-read from what actually happened rather than from what
      // was asked for. Driving into a wall therefore bleeds the speed off
      // instead of storing it up and firing the tank sideways along the wall
      // the moment it finds an opening.
      tank.vx = (moved.x - tank.x) / DT
      tank.vy = (moved.y - tank.y) / DT
      tank.x = moved.x
      tank.y = moved.y
    } else {
      tank.vx = 0
      tank.vy = 0
    }

    // Facing follows the push while there is one, and the drift after it, so a
    // tank coasting to a halt does not spin to face a direction it is no
    // longer travelling in.
    const facing = driving ? Math.atan2(my, mx)
      : Math.hypot(tank.vx, tank.vy) > 1 ? Math.atan2(tank.vy, tank.vx)
      : null
    if (facing !== null) {
      const diff = wrap(facing - tank.heading)
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
