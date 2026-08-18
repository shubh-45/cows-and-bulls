// Checks the between-cell drawing against real engine states.
const SNAKE = new URL('../src/games/snake', import.meta.url).pathname
const { glidingBody } = await import(`file://${SNAKE}/glide.js`)
const { createState, step } = await import(`file://${SNAKE}/engine.js`)

const same = (a, b) => a.length === b.length &&
  a.every((p, i) => Math.abs(p.x - b[i].x) < 1e-9 && Math.abs(p.y - b[i].y) < 1e-9)
const show = (pts) => pts.map((p) => `${+p.x.toFixed(2)},${+p.y.toFixed(2)}`).join(' ')

let pass = 0, fail = 0
const check = (label, ok, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${label}`) }
  else { fail++; console.log(`  FAIL  ${label}${detail ? '\n          ' + detail : ''}`) }
}

/* ---- 1. endpoints ---- */
console.log('endpoints:')
let s = createState(12345, 2)
let n = step(s, {})
for (const [i, snake] of s.snakes.entries()) {
  const next = n.snakes[i]
  check(`t=0 draws exactly the current cells (snake ${i})`,
    same(glidingBody(snake, next, 0), snake.body))
  // At t=1 the shape must BE the next body. The leading point is the new head
  // and the trailing duplicate collapses onto the new tail.
  const end = glidingBody(snake, next, 1)
  const expected = next.body
  const collapsed = end.slice(0, expected.length)
  check(`t=1 matches the next tick's body (snake ${i})`,
    same(collapsed, expected) && same([end[end.length - 1]], [expected[expected.length - 1]]),
    `got  ${show(end)}\n          want ${show(expected)}`)
}

/* ---- 2. constant drawn length while moving ---- */
console.log('\nlength stability (no growth):')
const len = (pts) => pts.slice(1).reduce((acc, p, i) =>
  acc + Math.hypot(p.x - pts[i].x, p.y - pts[i].y), 0)
const base = len(s.snakes[0].body)
let worst = 0
for (let t = 0; t <= 1.0001; t += 0.05) {
  worst = Math.max(worst, Math.abs(len(glidingBody(s.snakes[0], n.snakes[0], t)) - base))
}
check(`drawn length stays constant through the tick (drift ${worst.toFixed(4)})`, worst < 1e-9)

/* ---- 3. monotonic, sub-cell motion: no jumps ---- */
console.log('\nsmoothness:')
let maxHop = 0
let prev = glidingBody(s.snakes[0], n.snakes[0], 0)[0]
for (let t = 0.05; t <= 1.0001; t += 0.05) {
  const head = glidingBody(s.snakes[0], n.snakes[0], t)[0]
  maxHop = Math.max(maxHop, Math.hypot(head.x - prev.x, head.y - prev.y))
  prev = head
}
// 20 steps across one cell: each move must be a twentieth of a cell, never a
// whole one. A whole-cell move is the jump this change exists to remove.
check(`head advances in sub-cell steps (largest ${maxHop.toFixed(3)} cells)`, maxHop < 0.2)

/* ---- 4. a turn is glided into, not extrapolated straight ---- */
console.log('\nturning:')
const turning = step(s, { 0: 'down' })   // snake 0 starts facing right
const head0 = s.snakes[0].body[0]
const turnedHead = turning.snakes[0].body[0]
check('the turn actually changes the next head cell',
  turnedHead.y === head0.y + 1 && turnedHead.x === head0.x)
const mid = glidingBody(s.snakes[0], turning.snakes[0], 0.5)[0]
check('mid-turn the head is halfway into the NEW direction, not the old',
  Math.abs(mid.x - head0.x) < 1e-9 && Math.abs(mid.y - (head0.y + 0.5)) < 1e-9,
  `got ${show([mid])}, want ${show([{ x: head0.x, y: head0.y + 0.5 }])}`)

/* ---- 5. eating keeps the tail ---- */
console.log('\neating:')
let eat = createState(999, 2)
const h = eat.snakes[0].body[0]
eat = { ...eat, food: { x: h.x + 1, y: h.y } }   // food directly ahead
const afterEat = step(eat, {})
check('the snake grew by one cell', afterEat.snakes[0].body.length === eat.snakes[0].body.length + 1)
const tailNow = eat.snakes[0].body[eat.snakes[0].body.length - 1]
const drawn = glidingBody(eat.snakes[0], afterEat.snakes[0], 0.5)
const drawnTail = drawn[drawn.length - 1]
check('the tail stays put while eating (body lengthens, does not slide)',
  Math.abs(drawnTail.x - tailNow.x) < 1e-9 && Math.abs(drawnTail.y - tailNow.y) < 1e-9)

/* ---- 6. degenerate inputs fall back to the exact cells ---- */
console.log('\nfallbacks:')
check('no next state -> exact cells', same(glidingBody(s.snakes[0], null, 0.5), s.snakes[0].body))
const dead = { ...n.snakes[0], alive: false }
check('dying next tick -> exact cells (no sliding into a wall)',
  same(glidingBody(s.snakes[0], dead, 0.5), s.snakes[0].body))
const deadNow = { ...s.snakes[0], alive: false }
check('already dead -> exact cells', same(glidingBody(deadNow, n.snakes[0], 0.5), deadNow.body))

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
