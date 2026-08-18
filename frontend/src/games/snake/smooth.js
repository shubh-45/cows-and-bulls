// Hides a correction instead of teleporting through it.
//
// Pure and framework-free like glide.js, and presentation only: it changes
// where a snake is DRAWN, never where it is. Two players could run different
// smoothing, or none, without desyncing - the simulation never reads this.
//
// The problem it solves is the guest's alone. The referee is never corrected,
// so its board only ever moves forward; the guest predicts ahead, and when a
// late turn makes the referee rewind and rewrite a tick the guest has already
// drawn, the corrected snapshot replaces the picture outright and the snake
// jumps - backwards, and by up to five cells on a bad link. Measured over a
// 90-second match, the guest saw 2 such jumps on good wifi (0.46 cells, which
// is why this looked solved) and 18 on mobile data at up to 5 cells.
//
// So the fix is not to correct less, it is to stop showing the correction as a
// jump: keep drawing where the snake already was and slide to the truth over
// about a tenth of a second.

/** How quickly the error bleeds off. One time constant per ~90ms. */
export const SMOOTH_TAU_MS = 90
/**
 * The furthest the drawing may lag behind the truth.
 *
 * A ceiling is needed or a pathological correction would send the snake
 * gliding across half the board, which is a different lie from the one being
 * fixed. Anything past this is taken instantly and only the remainder eased.
 *
 * Five, because that is where the measured corrections top out - a lower
 * ceiling clips a real correction and puts the jump straight back. Worst
 * drawn jump on a 90-second match, before -> after:
 *
 *   good wifi     0.46 -> 0.08 cells      at 4: 0.08   at 3: 0.08
 *   Singapore     3.10 -> 0.51 cells      at 4: 0.51   at 3: 0.51
 *   mobile data   5.00 -> 0.84 cells      at 4: 1.61   at 3: 2.45
 *   poor mobile   5.00 -> 0.84 cells      at 4: 1.64   at 3: 2.47
 *
 * Raising it to 6 changes nothing, so this is the ceiling and not a guess.
 */
export const MAX_SMOOTH_CELLS = 5
/** Below this the offset is not worth carrying, and it stops it creeping. */
const SETTLED = 0.01

/**
 * Tracks one snake's drawn position across frames.
 *
 * Each snake needs its own, because they are corrected independently.
 */
export function createSmoother() {
  let offset = { x: 0, y: 0 }
  let lastRaw = null
  let lastAt = null

  return {
    /**
     * @param {Array<{x:number,y:number}>} cells where the snake really is now
     * @param {number} at a timestamp in ms
     * @param {number} tickMs the duel's tick, for judging what movement is normal
     * @returns the cells to actually draw
     */
    apply(cells, at, tickMs) {
      if (!cells?.length) return cells
      const raw = cells[0]
      const dt = lastAt === null ? 0 : Math.max(at - lastAt, 0)
      lastAt = at

      if (lastRaw) {
        // What this frame could legitimately have moved. Measured against the
        // time the frame actually took, because a stalled animation frame is
        // SUPPOSED to advance the snake further - calling that a correction
        // would smooth out ordinary motion and make the snake feel like syrup.
        const allowed = (dt / tickMs) * 1.6 + 0.05
        const moved = Math.hypot(raw.x - lastRaw.x, raw.y - lastRaw.y)
        if (moved > allowed) {
          // Absorb the discontinuity: keep drawing where we already were.
          offset.x += lastRaw.x - raw.x
          offset.y += lastRaw.y - raw.y
        }
      }
      lastRaw = { x: raw.x, y: raw.y }

      const size = Math.hypot(offset.x, offset.y)
      if (size > MAX_SMOOTH_CELLS) {
        const k = MAX_SMOOTH_CELLS / size
        offset.x *= k
        offset.y *= k
      }

      // Exponential decay, framed in elapsed time rather than in frames, so it
      // eases at the same rate whatever the device is managing.
      const decay = dt > 0 ? Math.exp(-dt / SMOOTH_TAU_MS) : 1
      offset.x *= decay
      offset.y *= decay
      if (Math.hypot(offset.x, offset.y) < SETTLED) { offset.x = 0; offset.y = 0 }

      if (offset.x === 0 && offset.y === 0) return cells
      return cells.map((c) => ({ x: c.x + offset.x, y: c.y + offset.y }))
    },
  }
}
