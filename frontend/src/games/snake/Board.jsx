import { DIRECTIONS, OPPOSITE } from './engine'

// Shared by solo and (later) the duel, so both render an identical board.
//
// Only the snake segments and the food are React elements - the grid itself is
// a CSS background. Re-rendering 225 cells ten times a second would be a lot
// of pointless DOM work; a snake is ~20 elements and the board never changes.
// Positions are percentages so the whole thing scales with the container and
// needs no pixel maths or resize listener.

export default function SnakeBoard({ state, tickMs, onSteer, palette = ['p1', 'p2'] }) {
  const cellW = 100 / state.width
  const cellH = 100 / state.height

  // A tap steers relative to travel: left half of the board turns you left,
  // right half turns you right. Two enormous targets, no diagonals to fumble,
  // and it works one-thumbed - which matters more than a swipe once the snake
  // speeds up.
  function handleTap(event) {
    if (!onSteer) return
    const rect = event.currentTarget.getBoundingClientRect()
    const point = event.changedTouches ? event.changedTouches[0] : event
    const left = point.clientX - rect.left < rect.width / 2
    onSteer(left ? 'turn-left' : 'turn-right')
  }

  return (
    <div
      className="snake-board"
      onPointerDown={handleTap}
      style={{ '--cols': state.width, '--rows': state.height }}
      role="application"
      aria-label="Snake board"
    >
      {state.food && (
        <span
          className="snake-food"
          style={{
            left: `${state.food.x * cellW}%`,
            top: `${state.food.y * cellH}%`,
            width: `${cellW}%`,
            height: `${cellH}%`,
          }}
        />
      )}

      {state.snakes.map((snake, snakeIndex) =>
        snake.body.map((part, i) => (
          <span
            key={`${snake.id}-${i}`}
            className={[
              'snake-seg',
              `snake-${palette[snakeIndex] ?? 'p1'}`,
              i === 0 ? 'is-head' : '',
              snake.alive ? '' : 'is-dead',
            ].filter(Boolean).join(' ')}
            style={{
              left: `${part.x * cellW}%`,
              top: `${part.y * cellH}%`,
              width: `${cellW}%`,
              height: `${cellH}%`,
              // Later segments fade slightly, which makes the direction of
              // travel readable at a glance on a small screen.
              opacity: snake.alive ? Math.max(0.45, 1 - i * 0.03) : 0.3,
              // Matching the transition to the tick makes movement continuous
              // rather than a series of jumps.
              transitionDuration: `${tickMs}ms`,
            }}
          />
        ))
      )}
    </div>
  )
}

/** Turns a relative steer into an absolute direction. */
export function steerFrom(currentDir, steer) {
  const order = ['up', 'right', 'down', 'left']
  const at = order.indexOf(currentDir)
  if (at === -1) return currentDir
  if (steer === 'turn-left') return order[(at + 3) % 4]
  if (steer === 'turn-right') return order[(at + 1) % 4]
  // an absolute direction, e.g. from the keyboard
  if (DIRECTIONS[steer] && steer !== OPPOSITE[currentDir]) return steer
  return currentDir
}
