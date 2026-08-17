// Explicit .js so this module can be imported by plain Node as well as Vite.
import { createState, step } from './engine.js'

// One browser referees; both play without waiting for anyone.
//
// This replaced lockstep, which could not give a playable duel for two reasons
// that no amount of tuning fixed:
//
//   - It refused to step a tick until BOTH players' inputs were in hand, so a
//     dimmed screen or a one-second network gap on your friend's phone froze
//     YOUR game. Each player's game was hostage to the other's device.
//   - Input lag was (INPUT_DELAY + 1) * TICK_MS with INPUT_DELAY >= 1, so a
//     turn could never land sooner than two cells ahead. That is the "we bump
//     into the wall before we act" problem, and it was structural.
//
// Here the host simulates on its own clock and never waits. The guest plays its
// own snake immediately and sends the turn; the host honours the tick the guest
// tagged, rewinding a tick or two if the message arrived just after that
// boundary. So the guest's prediction is what actually happens, and a turn
// lands on the very next tick - the same responsiveness as the solo game, which
// is the floor for any grid game.
//
// The engine is pure, so rewinding is just calling step() again over a couple of
// stored states. That is what makes this affordable.

/** One cell of travel. This is now literal: the old lockstep ran at
    TICK_MS / (INPUT_DELAY + 1) because of a runaway in its commit loop. */
export const TICK_MS = 220

/** Bumped whenever the wire format or the simulation would differ. */
export const PROTOCOL_VERSION = 3

export const HOST_SEAT = 0
export const GUEST_SEAT = 1

/**
 * How far back the host will redo history for a late input.
 *
 * At 220ms a tick and ~80ms one-way, a turn tagged for the next tick misses its
 * boundary about a third of the time - purely a function of when in the tick
 * the player happened to press. Redoing one or two ticks costs two calls to a
 * pure function and buys the guest the same instant response the host gets.
 * Beyond that the correction would be more visible than the lag it removes.
 */
const MAX_REWIND = 3

/** States and inputs kept for rewinding. A little more than MAX_REWIND. */
const HISTORY = 8

/**
 * @param {object} options
 * @param {number} options.seed shared, so both sides get the same food
 * @param {'host'|'guest'} options.role
 * @param {(state:object)=>void} options.onState
 * @param {(msg:object)=>void} options.send
 */
export function createDuel({ seed, role, onState, send }) {
  const isHost = role === 'host'
  const localSeat = isHost ? HOST_SEAT : GUEST_SEAT

  let state = createState(seed, 2)

  /** tick -> the state AT that tick, for rewinding. Host only. */
  const past = new Map([[0, state]])
  /** tick -> the inputs that produced it, so a redo can reuse them. */
  const applied = new Map()
  /** Guest turns tagged for a tick the host has not reached yet. */
  const scheduled = new Map()

  /** This player's steer, waiting for the next tick. */
  let myTurn = null
  /** Guest only: the tick myTurn was tagged for, so it can be cleared. */
  let myTurnTick = null

  // When the currently-drawn tick started, for the glide between cells. The
  // host sets it from its own step; the guest runs a clock that tracks the
  // referee's cadence rather than jumping to each packet's arrival.
  let tickStartedAt = now()

  /**
   * Whether the referee has actually started this match.
   *
   * The two countdowns do not finish together - the host only learns the room
   * is PLAYING on its next poll - so the guest can be counted in and waiting
   * while the referee is still counting down. Without this the guest showed
   * "waiting for your friend" over a board that had simply not begun.
   */
  let started = isHost

  /**
   * Cadence measurements, for the diagnostics readout.
   *
   * The duel misbehaves on real phones in ways that cannot be reproduced from
   * a desktop or asserted in a test - a stalled rAF, a throttled tab, a mobile
   * link. Rather than keep guessing at it, the game measures itself and can be
   * asked what it saw.
   */
  const gaps = []
  let rollbacks = 0
  let lastBeatAt = null
  function recordBeat() {
    const at = now()
    if (lastBeatAt !== null) {
      gaps.push(at - lastBeatAt)
      if (gaps.length > 60) gaps.shift()
    }
    lastBeatAt = at
  }

  function now() {
    return typeof performance !== 'undefined' ? performance.now() : Date.now()
  }

  function prune() {
    for (const tick of past.keys()) if (tick < state.tick - HISTORY) past.delete(tick)
    for (const tick of applied.keys()) if (tick < state.tick - HISTORY) applied.delete(tick)
  }

  function broadcast() {
    // The whole state: a couple of short arrays, a few hundred bytes, four or
    // five times a second. Sending diffs would save nothing worth the bugs.
    send?.({ k: 's', v: PROTOCOL_VERSION, t: state.tick, s: state })
  }

  return {
    /**
     * Advance one tick of real time. Host only - the guest's clock is the
     * arrival of snapshots, so it has nothing to drive.
     *
     * Exactly one step per call, so the simulation can never outrun the wall
     * clock the way lockstep's did.
     */
    tick() {
      if (!isHost || state.status === 'over') return
      const target = state.tick + 1
      const inputs = {
        [HOST_SEAT]: myTurn,
        [GUEST_SEAT]: scheduled.get(target) ?? null,
      }
      applied.set(target, inputs)
      scheduled.delete(target)
      myTurn = null

      state = step(state, inputs)
      past.set(state.tick, state)
      tickStartedAt = now()
      recordBeat()
      prune()
      broadcast()
      onState?.(state)
    },

    /**
     * Re-send the current state. Called when the pair re-forms.
     *
     * Snapshots only go out as ticks happen, so a guest that was away when the
     * match ended would never hear the ending: the referee has stopped ticking,
     * and its board would sit frozen on the last tick it saw, mid-match, for
     * good. One snapshot on reconnect settles it.
     */
    resync() {
      if (isHost) broadcast()
    },

    /** Queue a direction. It takes effect on the very next tick. */
    steer(direction) {
      if (state.status === 'over') return
      myTurn = direction
      if (!isHost) {
        // Tagged with the tick it is meant for, so the host can honour it even
        // if the message lands just after that boundary.
        myTurnTick = state.tick + 1
        send?.({ k: 'u', v: PROTOCOL_VERSION, t: myTurnTick, d: direction })
      }
    },

    /** A message from the other player. */
    receive(msg) {
      if (!msg || msg.v !== PROTOCOL_VERSION) return

      if (msg.k === 's' && !isHost) {
        // The host is the referee; its word replaces whatever was predicted.
        // Nothing needs reconciling because the host honours the tagged tick,
        // so a prediction that was made is a prediction that came true.
        if (msg.s && msg.t >= state.tick) {
          const advanced = msg.t > state.tick
          const wasStarted = started
          state = msg.s
          started = true

          if (advanced) recordBeat()

          if (advanced && !wasStarted) {
            // First snapshot of the match: start the clock cleanly rather than
            // phase-locking against a cadence that does not exist yet.
            tickStartedAt = now()
          } else if (advanced) {
            // A LOCAL clock that tracks the referee's cadence, rather than one
            // reset by each arriving packet.
            //
            // Restarting the glide on arrival made every scrap of network
            // jitter a visible stutter, and a snapshot that ran late froze the
            // board outright - which is why the referee looked flawless while
            // the other player stuttered. Easing towards the observed cadence
            // absorbs the jitter; only a genuinely large gap resynchronises
            // hard.
            const expected = tickStartedAt + TICK_MS
            const drift = now() - expected
            tickStartedAt = Math.abs(drift) > TICK_MS ? now() : expected + drift * 0.2
            // Never put the clock in the future. Easing towards a snapshot that
            // arrived early can overshoot, and a negative progress means the
            // board draws no movement at all - the snake would sit still until
            // the clock caught up, which is the very symptom being fixed.
            if (tickStartedAt > now()) tickStartedAt = now()
          }
          // A same-tick snapshot is a CORRECTION - the referee redid history to
          // honour a turn that arrived late. Restarting the glide for it put a
          // visible hitch on the board at exactly the moment a player turns,
          // which is precisely when they are watching. The board is corrected;
          // the clock is left alone.

          if (myTurnTick !== null && state.tick >= myTurnTick) {
            myTurn = null
            myTurnTick = null
          }
          onState?.(state)
        }
        return
      }

      if (msg.k === 'u' && isHost) {
        const target = msg.t
        // Once the match is decided, history stops being negotiable.
        if (state.status === 'over') return
        if (target > state.tick) {
          scheduled.set(target, msg.d)
          return
        }
        if (target < state.tick - MAX_REWIND) return

        const base = past.get(target - 1)
        if (!base) return

        // Redo the affected ticks with the turn included. Every other input is
        // replayed exactly, so nothing else about the match changes.
        let redone = base
        for (let t = target; t <= state.tick; t++) {
          const inputs = { ...(applied.get(t) ?? {}) }
          if (t === target) inputs[GUEST_SEAT] = msg.d
          applied.set(t, inputs)
          redone = step(redone, inputs)
          past.set(t, redone)
          if (redone.status === 'over') break
        }
        state = redone
        rollbacks++
        broadcast()
        onState?.(state)
      }
    },

    /**
     * The state one tick ahead, for gliding between cells.
     *
     * The host knows both inputs, so its lookahead is exact. The guest applies
     * its own turn and lets the opponent continue straight, which is what makes
     * its own snake respond on the next tick rather than a round trip later.
     */
    peekNext() {
      if (state.status === 'over') return null
      return isHost
        ? step(state, {
            [HOST_SEAT]: myTurn,
            [GUEST_SEAT]: scheduled.get(state.tick + 1) ?? null,
          })
        : step(state, { [GUEST_SEAT]: myTurn })
    },

    /** 0..1 through the current tick, for the glide. Clamped at both ends:
        anything below 0 draws as no movement at all. */
    progress() {
      const t = (now() - tickStartedAt) / TICK_MS
      return t < 0 ? 0 : t > 1 ? 1 : t
    },

    /**
     * How long since the referee last said anything, in ms. Guest only, and
     * only once it has actually started - a match that has not begun is not a
     * connection problem, and reporting it as one was alarming for something
     * entirely normal.
     */
    silentFor() {
      return isHost || !started ? 0 : now() - tickStartedAt
    },

    /**
     * What the cadence actually looked like. `gap` is the interval between
     * ticks produced (referee) or snapshots that advanced the match (guest);
     * it should sit at TICK_MS, and the spread is what a player feels as
     * stutter.
     */
    stats() {
      if (!gaps.length) return null
      const sorted = [...gaps].sort((a, b) => a - b)
      const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length
      return {
        n: gaps.length,
        mean: Math.round(mean),
        min: Math.round(sorted[0]),
        max: Math.round(sorted[sorted.length - 1]),
        p90: Math.round(sorted[Math.floor(sorted.length * 0.9)]),
        // Beats more than half a tick late: the ones that read as a hitch.
        late: gaps.filter((g) => g > TICK_MS * 1.5).length,
        rollbacks,
      }
    },

    get localSeat() {
      return localSeat
    },

    get isHost() {
      return isHost
    },

    get state() {
      return state
    },
  }
}
