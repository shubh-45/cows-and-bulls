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
 * How far the guest's own clock may run past the referee's last word.
 *
 * One tick is the normal lead - the snapshot for the tick being drawn is still
 * in flight. Beyond a couple, the referee has gone quiet and predicting further
 * would only build up a correction to pay for later.
 */
const MAX_LEAD = 3

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

  /**
   * Guest only: the referee's last word, and this client's own clock.
   *
   * `state` is what gets DRAWN. For the referee they are the same thing. For
   * the guest they must not be: drawing the newest snapshot directly meant the
   * picture only changed when a packet landed, so an early packet was a jump, a
   * late one a freeze, and a mispredicted turn a snap backwards. Measured over
   * a simulated match that was 7-9% of frames frozen, freezes up to 455ms and
   * dozens of snap-backs, while the referee's own screen was flawless - which
   * is exactly the asymmetry players reported.
   *
   * So the guest keeps the referee's state as truth and runs its own tick
   * clock on top, replaying its own turns forward from it. The picture then
   * advances on a local clock like the referee's, and snapshots only correct
   * it.
   */
  let auth = state
  let localTick = 0
  /** tick -> this player's turn for that tick, for replaying the prediction. */
  const myTurns = new Map()

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
  /** Guest: when the referee last said anything, for the silence warning. */
  let lastWordAt = now()

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

  /**
   * Guest: replay from the referee's last word up to this client's own tick.
   *
   * Never more than a tick or two of replay, and every step is the same pure
   * engine the referee runs, so the prediction is the referee's own answer
   * arriving early rather than a guess at it.
   */
  function rebuildDisplay() {
    let s = auth
    for (let t = auth.tick + 1; t <= localTick; t++) {
      s = step(s, { [GUEST_SEAT]: myTurns.get(t) ?? null })
    }
    // A predicted death is not a result. Only the referee ends a match, so a
    // prediction that runs into something waits to be confirmed rather than
    // showing a game over that may be withdrawn a moment later.
    if (auth.status !== 'over' && s.status === 'over') s = auth
    state = s
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
      if (!isHost) {
        // The guest's clock. It draws on its own beat exactly as the referee
        // does; snapshots correct the picture rather than driving it.
        if (auth.status === 'over') return
        // Never run away from the truth: if replies stop arriving, hold rather
        // than predicting further and further into a future that may not
        // happen.
        if (localTick - auth.tick >= MAX_LEAD) return
        localTick += 1
        rebuildDisplay()
        tickStartedAt = now()
        recordBeat()
        onState?.(state)
        return
      }
      if (state.status === 'over') return
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
        // if the message lands just after that boundary. The same tag is kept
        // locally, so the prediction replays the turn at precisely the tick the
        // referee will apply it - which is what stops the board correcting
        // itself a moment later.
        myTurnTick = localTick + 1
        myTurns.set(myTurnTick, direction)
        for (const t of myTurns.keys()) if (t < localTick - HISTORY) myTurns.delete(t)
        send?.({ k: 'u', v: PROTOCOL_VERSION, t: myTurnTick, d: direction })
      }
    },

    /** A message from the other player. */
    receive(msg) {
      if (!msg || msg.v !== PROTOCOL_VERSION) return

      if (msg.k === 's' && !isHost) {
        // The referee's word is truth. It does not become the picture directly:
        // it replaces the base the local clock predicts forward from, so the
        // board keeps moving on its own beat and a snapshot only corrects it.
        if (msg.s && msg.t >= auth.tick) {
          const wasStarted = started
          auth = msg.s
          started = true
          lastWordAt = now()

          if (!wasStarted) {
            // First word of the match: adopt the referee's tick and start the
            // local clock from here.
            localTick = auth.tick
            tickStartedAt = now()
            recordBeat()
          } else if (auth.tick > localTick) {
            // Truth has overtaken us - the local clock fell behind, so catch up
            // rather than drawing a past the referee has already left.
            localTick = auth.tick
            recordBeat()
          }

          // A turn the referee has now accounted for is no longer a prediction.
          if (myTurnTick !== null && auth.tick >= myTurnTick) {
            myTurn = null
            myTurnTick = null
          }
          if (auth.status === 'over') {
            localTick = auth.tick
            myTurns.clear()
          }

          rebuildDisplay()
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
        : step(state, { [GUEST_SEAT]: myTurns.get(localTick + 1) ?? null })
    },

    /**
     * How long this client should wait before its next tick.
     *
     * The referee's is fixed. The guest's is nudged, because two clocks running
     * at a nominal 220ms drift apart: fall behind and a snapshot drags the
     * board forward, run ahead and the prediction has to be held back - both
     * read as a stumble. Holding the lead at one tick keeps the snapshot for
     * the tick being drawn exactly in flight, which is the steady state this
     * design wants.
     */
    tickInterval() {
      if (isHost) return TICK_MS
      const lead = localTick - auth.tick
      if (lead > 1) return TICK_MS * 1.08
      if (lead < 1) return TICK_MS * 0.92
      return TICK_MS
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
      return isHost || !started ? 0 : now() - lastWordAt
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
