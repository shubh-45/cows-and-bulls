// The Snake simulation. Pure, deterministic and framework-free.
//
// This module is written for the multiplayer duel even though solo play is
// what uses it first. Two browsers will each run this engine and exchange only
// their *inputs*, never positions - so both must compute byte-identical
// results from the same seed and the same input sequence. Everything here
// follows from that one requirement:
//
//   - no Math.random(): randomness comes from a seeded PRNG whose state lives
//     inside the game state, so it advances in lockstep on both machines
//   - no floats: the board is integers on a grid, so there is nothing to drift
//   - no Date/now(): timing belongs to the caller, not the simulation
//   - snakes are always processed in id order, so "who is resolved first"
//     can never depend on object iteration order
//
// The whole simulation is `step(state, inputs) -> state`. Nothing mutates.

export const DIRECTIONS = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
}

export const OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' }

export const GRID_WIDTH = 15
export const GRID_HEIGHT = 15

export const FOOD_POINTS = 10
/** Past this length every food is worth more - the late game is the risky part. */
export const DANGER_LENGTH = 10
export const DANGER_BONUS = 5

export const DEATH = {
  WALL: 'wall',
  SELF: 'self',
  OPPONENT: 'opponent',
  HEAD_ON: 'head-on',
}

/* ---- deterministic randomness ------------------------------------------ */

// mulberry32: tiny, fast, and - crucially - its entire state is one 32-bit
// integer, so it can live inside the game state and be reproduced exactly.
function nextRandom(rngState) {
  let a = (rngState + 0x6d2b79f5) | 0
  let t = Math.imul(a ^ (a >>> 15), 1 | a)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296
  return { value, rngState: a }
}

/** Turns an arbitrary string into a 32-bit seed, so room codes can seed a match. */
export function seedFromString(text) {
  let hash = 2166136261
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

/* ---- state -------------------------------------------------------------- */

const key = (cell) => `${cell.x},${cell.y}`

function makeSnake(id, x, y, dir) {
  return {
    id,
    // head first, tail last
    body: [
      { x, y },
      { x: x - DIRECTIONS[dir].x, y: y - DIRECTIONS[dir].y },
      { x: x - DIRECTIONS[dir].x * 2, y: y - DIRECTIONS[dir].y * 2 },
    ],
    dir,
    alive: true,
    score: 0,
    foodEaten: 0,
    diedAtTick: null,
    causeOfDeath: null,
  }
}

/**
 * @param {number} seed
 * @param {number} playerCount 1 for solo, 2 for a duel
 */
export function createState(seed, playerCount = 1) {
  const snakes =
    playerCount === 1
      ? [makeSnake(0, 2, Math.floor(GRID_HEIGHT / 2), 'right')]
      : [
          makeSnake(0, 2, Math.floor(GRID_HEIGHT / 2), 'right'),
          makeSnake(1, GRID_WIDTH - 3, Math.floor(GRID_HEIGHT / 2), 'left'),
        ]

  const state = {
    tick: 0,
    width: GRID_WIDTH,
    height: GRID_HEIGHT,
    snakes,
    food: null,
    rngState: seed | 0,
    status: 'running',
  }
  return spawnFood(state)
}

/* ---- helpers ------------------------------------------------------------ */

function occupiedCells(snakes) {
  const cells = new Set()
  for (const snake of snakes) {
    if (!snake.alive) continue
    for (const part of snake.body) cells.add(key(part))
  }
  return cells
}

/**
 * Places food on a free square, chosen from the free list by index so the
 * choice depends only on the PRNG - never on Set or object ordering.
 */
function spawnFood(state) {
  const taken = occupiedCells(state.snakes)
  const free = []
  for (let y = 0; y < state.height; y++) {
    for (let x = 0; x < state.width; x++) {
      if (!taken.has(`${x},${y}`)) free.push({ x, y })
    }
  }
  if (free.length === 0) return { ...state, food: null }

  const { value, rngState } = nextRandom(state.rngState)
  return { ...state, food: free[Math.floor(value * free.length)], rngState }
}

function inBounds(cell, state) {
  return cell.x >= 0 && cell.x < state.width && cell.y >= 0 && cell.y < state.height
}

function pointsFor(snake) {
  return FOOD_POINTS + (snake.body.length > DANGER_LENGTH ? DANGER_BONUS : 0)
}

/* ---- the step ----------------------------------------------------------- */

/**
 * Advances the simulation exactly one tick.
 *
 * @param {object} state
 * @param {object} inputs `{ [snakeId]: 'up'|'down'|'left'|'right' }` - a snake
 *   with no entry simply keeps going the way it was.
 * @returns a new state; the input is never mutated
 */
export function step(state, inputs = {}) {
  if (state.status === 'over') return state

  // 1. Turn. A snake cannot reverse into itself, so a 180 is ignored rather
  //    than being an instant death - that would punish a fumbled swipe.
  const turned = state.snakes.map((snake) => {
    const requested = inputs[snake.id]
    if (!snake.alive || !requested || !DIRECTIONS[requested]) return snake
    if (requested === OPPOSITE[snake.dir]) return snake
    return { ...snake, dir: requested }
  })

  // 2. Everyone's head target, computed before anyone moves - snakes move
  //    simultaneously, so nobody gets to react to anybody else's move.
  const heads = turned.map((snake) =>
    snake.alive
      ? { x: snake.body[0].x + DIRECTIONS[snake.dir].x, y: snake.body[0].y + DIRECTIONS[snake.dir].y }
      : null
  )

  const eating = turned.map((snake, i) =>
    Boolean(snake.alive && state.food && heads[i].x === state.food.x && heads[i].y === state.food.y)
  )

  // 3. Which squares are still occupied *after* this tick. A tail that is
  //    about to move away does not count - chasing someone's tail should be
  //    allowed, and it is how the game is normally played.
  const blocked = new Map()
  turned.forEach((snake, i) => {
    if (!snake.alive) return
    const keepTail = eating[i]
    const lasting = keepTail ? snake.body : snake.body.slice(0, -1)
    for (const part of lasting) blocked.set(key(part), snake.id)
  })

  // 4. Resolve deaths. Every cause is checked against the pre-move world, so
  //    two snakes can die on the same tick and neither is favoured.
  const deaths = new Map()
  turned.forEach((snake, i) => {
    if (!snake.alive) return
    const head = heads[i]

    if (!inBounds(head, state)) {
      deaths.set(snake.id, DEATH.WALL)
      return
    }
    // Head-on: two live heads targeting the same square. Both die.
    const rival = turned.findIndex(
      (other, j) => j !== i && other.alive && heads[j] && heads[j].x === head.x && heads[j].y === head.y
    )
    if (rival !== -1) {
      deaths.set(snake.id, DEATH.HEAD_ON)
      return
    }
    const hit = blocked.get(key(head))
    if (hit !== undefined) {
      deaths.set(snake.id, hit === snake.id ? DEATH.SELF : DEATH.OPPONENT)
    }
  })

  // 5. Move the survivors.
  const nextSnakes = turned.map((snake, i) => {
    if (!snake.alive) return snake
    if (deaths.has(snake.id)) {
      return { ...snake, alive: false, diedAtTick: state.tick + 1, causeOfDeath: deaths.get(snake.id) }
    }

    const body = [heads[i], ...snake.body]
    if (!eating[i]) body.pop()

    return eating[i]
      ? { ...snake, body, score: snake.score + pointsFor(snake), foodEaten: snake.foodEaten + 1 }
      : { ...snake, body }
  })

  let next = { ...state, tick: state.tick + 1, snakes: nextSnakes }

  if (eating.some(Boolean)) next = spawnFood(next)

  // 6. Solo ends when the only snake dies; a duel ends when fewer than two
  //    are left standing.
  const alive = nextSnakes.filter((snake) => snake.alive).length
  const finished = nextSnakes.length === 1 ? alive === 0 : alive <= 1
  if (finished) next = { ...next, status: 'over' }

  return next
}

/* ---- reading the result ------------------------------------------------- */

/**
 * @returns `{ outcome: 'win'|'lose'|'draw', winnerId }` from `viewerId`'s
 *   point of view, or null while the game is still running.
 */
export function resultFor(state, viewerId = 0) {
  if (state.status !== 'over' || state.snakes.length < 2) return null

  const [a, b] = state.snakes
  // Both still standing means the clock ran out - highest score takes it.
  if (a.alive && b.alive) {
    if (a.score === b.score) return { outcome: 'draw', winnerId: null }
    const winner = a.score > b.score ? a : b
    return { outcome: winner.id === viewerId ? 'win' : 'lose', winnerId: winner.id }
  }
  if (a.alive === b.alive) return { outcome: 'draw', winnerId: null }

  const winner = a.alive ? a : b
  return { outcome: winner.id === viewerId ? 'win' : 'lose', winnerId: winner.id }
}

/** Ends the match when the duel clock expires; highest score wins. */
export function endOnTimeout(state) {
  return state.status === 'over' ? state : { ...state, status: 'over' }
}

/**
 * Tick length in ms. Solo speeds up as you grow so the pressure builds; a duel
 * stays fixed, because two machines stepping a shared clock must not disagree
 * about how fast time is passing.
 */
export function tickInterval(state, { ramp = true } = {}) {
  if (!ramp) return 130
  const length = state.snakes[0]?.body.length ?? 3
  // Starts calmer than it used to and ramps more gently. A faster tick also
  // means less waiting for an input to be applied, so slowing the game down
  // trades some responsiveness away - which is why the head now acknowledges
  // a turn on the frame you make it, rather than only when the body moves.
  return Math.max(100, 200 - (length - 3) * 4)
}
