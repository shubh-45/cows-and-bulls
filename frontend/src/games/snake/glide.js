// Where to draw a snake part-way between two ticks.
//
// Pure and framework-free, like engine.js and authority.js, so it can be checked
// from plain Node - which matters here because the thing it produces is
// impossible to assert by looking at a screenshot.
//
// This is presentation only. It never touches the simulation: both browsers
// still step identical states, and two players could run different smoothing
// without desyncing.

export const lerp = (from, to, t) => ({
  x: from.x + (to.x - from.x) * t,
  y: from.y + (to.y - from.y) * t,
})

/**
 * The body part-way through its move, so the snake glides between cells instead
 * of teleporting a whole cell at each tick.
 *
 * The head extends towards the cell it is about to occupy while the tail
 * retracts out of the one it is leaving, which keeps the drawn length constant
 * and reads as continuous movement. `next` is the real next state rather than a
 * guess, so a turn is glided into correctly instead of being extrapolated
 * straight ahead and then snapped sideways - which at 380ms a tick would be
 * obvious precisely when the player is watching.
 *
 * Returns one more point than the body has cells: at t=0 the extra point sits
 * exactly on the head, at t=1 the shape is precisely `next`. A duplicated
 * vertex is invisible on a polyline with round caps and joins.
 *
 * @param {object} snake the snake now
 * @param {object|null} next the same snake one tick ahead, or null if unknown
 * @param {number} t 0..1 through the current tick
 */
export function glidingBody(snake, next, t) {
  const body = snake.body
  // Nothing to glide towards, not started yet, or dying this tick - a death is
  // not a move, so easing into it would slide the head somewhere it never goes.
  if (!next || t <= 0 || !snake.alive || !next.alive) return body

  const progress = Math.min(t, 1)
  const grew = next.body.length > body.length
  const points = [lerp(body[0], next.body[0], progress)]
  for (let i = 0; i < body.length - 1; i++) points.push(body[i])

  const tail = body[body.length - 1]
  const ahead = body[body.length - 2] ?? tail
  // A snake that eats this tick keeps its tail cell; every other snake vacates
  // it, and retracting is what stops the body appearing to stretch.
  points.push(grew ? tail : lerp(tail, ahead, progress))
  return points
}
