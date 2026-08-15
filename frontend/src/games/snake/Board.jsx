import { useRef } from 'react'
import { DEATH, DIRECTIONS, OPPOSITE } from './engine'

// Shared by solo and (later) the duel, so both render an identical board.
//
// The snake is drawn as one SVG polyline rather than a row of separate boxes.
// Boxes left visible gaps between segments, so the body read as a string of
// beads; a single stroke with round joins is continuous through corners and
// gives a real body you can make thinner or thicker with one number.

/** Body thickness in grid units - 1 would fill a whole cell edge to edge. */
const BODY_WIDTH = 0.62
const HEAD_RADIUS = 0.42
/** A drag shorter than this counts as a tap, not a swipe. */
const SWIPE_MIN_PX = 22

/**
 * @param {string|null} facing the direction already accepted but not yet
 *   stepped, so the head can acknowledge input before the body moves.
 */
export default function SnakeBoard({ state, onSteer, facing = null, palette = ['p1', 'p2'] }) {
  const gesture = useRef(null)

  const hitWall = state.snakes.some(
    (snake) => !snake.alive && snake.causeOfDeath === DEATH.WALL
  )

  // One surface, two controls: a swipe gives an absolute direction, a tap
  // steers relative to travel (left half turns left, right half turns right)
  // so the board stays usable one-thumbed.
  //
  // The swipe fires the moment the finger passes the threshold, NOT on
  // release. Waiting for release meant the turn only registered once you
  // lifted off, so the whole flick - finger travel plus release - was added
  // on top of the tick delay and the game felt laggy to steer.
  function handleDown(event) {
    if (!onSteer) return
    event.currentTarget.setPointerCapture?.(event.pointerId)
    gesture.current = {
      x: event.clientX,
      y: event.clientY,
      rect: event.currentTarget.getBoundingClientRect(),
      fired: false,
    }
  }

  function handleMove(event) {
    const gest = gesture.current
    if (!onSteer || !gest || gest.fired) return

    const dx = event.clientX - gest.x
    const dy = event.clientY - gest.y
    if (Math.hypot(dx, dy) < SWIPE_MIN_PX) return

    // Latch so the rest of the drag doesn't keep re-steering.
    gest.fired = true
    // Dominant axis wins, so a slightly diagonal swipe still does the obvious
    // thing rather than being rejected.
    onSteer(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up')
  }

  function handleUp(event) {
    const gest = gesture.current
    gesture.current = null
    // A swipe already steered on the way past the threshold; anything that
    // never got that far is a tap.
    if (!onSteer || !gest || gest.fired) return
    onSteer(event.clientX - gest.rect.left < gest.rect.width / 2 ? 'turn-left' : 'turn-right')
  }

  return (
    <div
      className={`snake-board ${hitWall ? 'is-wall-hit' : ''}`}
      onPointerDown={handleDown}
      onPointerMove={handleMove}
      onPointerUp={handleUp}
      onPointerCancel={() => { gesture.current = null }}
      style={{ '--cols': state.width, '--rows': state.height }}
      role="application"
      aria-label="Snake board"
    >
      <svg
        className="snake-layer"
        viewBox={`0 0 ${state.width} ${state.height}`}
        aria-hidden="true"
      >
        {state.food && (
          <circle
            className="snake-food"
            cx={state.food.x + 0.5}
            cy={state.food.y + 0.5}
            r={0.3}
          />
        )}

        {state.snakes.map((snake, index) => (
          <Snake
            key={snake.id}
            snake={snake}
            tone={palette[index] ?? 'p1'}
            facing={index === 0 ? facing : null}
          />
        ))}
      </svg>
    </div>
  )
}

function Snake({ snake, tone, facing }) {
  const points = snake.body.map((part) => `${part.x + 0.5},${part.y + 0.5}`).join(' ')
  const head = snake.body[0]
  // The eyes look where the *accepted* input points, which may be one tick
  // ahead of where the body has actually moved. With a slower tick that
  // acknowledgement is what stops a turn feeling like it was dropped.
  const dir = DIRECTIONS[facing ?? snake.dir] ?? DIRECTIONS[snake.dir]

  // Eyes sit ahead of the head centre and to either side of the direction of
  // travel, which is what makes it read as a snake rather than a dot.
  const ahead = { x: head.x + 0.5 + dir.x * 0.12, y: head.y + 0.5 + dir.y * 0.12 }
  const side = { x: -dir.y * 0.16, y: dir.x * 0.16 }

  return (
    <g className={`snake-body snake-${tone} ${snake.alive ? '' : 'is-dead'}`}>
      <polyline
        className="snake-stroke"
        points={points}
        strokeWidth={BODY_WIDTH}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <circle className="snake-head" cx={head.x + 0.5} cy={head.y + 0.5} r={HEAD_RADIUS} />
      {snake.alive && (
        <>
          <circle className="snake-eye" cx={ahead.x + side.x} cy={ahead.y + side.y} r={0.08} />
          <circle className="snake-eye" cx={ahead.x - side.x} cy={ahead.y - side.y} r={0.08} />
        </>
      )}
    </g>
  )
}

/** Turns a relative steer into an absolute direction. */
export function steerFrom(currentDir, steer) {
  const order = ['up', 'right', 'down', 'left']
  const at = order.indexOf(currentDir)
  if (at === -1) return currentDir
  if (steer === 'turn-left') return order[(at + 3) % 4]
  if (steer === 'turn-right') return order[(at + 1) % 4]
  // an absolute direction, from a swipe or the keyboard
  if (DIRECTIONS[steer] && steer !== OPPOSITE[currentDir]) return steer
  return currentDir
}
