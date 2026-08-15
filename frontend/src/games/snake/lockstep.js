// Explicit .js so this module can be imported by plain Node as well as Vite.
// Lockstep is the part most worth testing outside a browser - two instances
// exchanging inputs is exactly what a test can simulate and a browser cannot.
import { createState, step } from './engine.js'

// Lockstep: both browsers run the same simulation and exchange only inputs.
//
// Nobody sends positions, so the two screens cannot disagree about who crashed
// into whom - there is no referee to appeal to and none is needed. What makes
// it work is that a tick is only stepped once BOTH players' inputs for that
// tick are in hand.
//
// The price is input delay. An input made now is scheduled INPUT_DELAY ticks
// into the future, which buys that much network time for it to reach the other
// side. Too small and the game stalls waiting; too large and steering feels
// remote.

// Slower than it was: at 150ms the duel felt frantic, and unlike solo there
// is no ramp - a shared clock has to stay constant on both machines.
export const TICK_MS = 190
export const INPUT_DELAY = 2

/** Seat numbers must match on both machines, because the engine resolves
    collisions in snake-id order - if the two sides disagreed about which snake
    is which, identical inputs would produce different deaths. */
export const HOST_SEAT = 0
export const GUEST_SEAT = 1

/**
 * @param {object} options
 * @param {number} options.seed shared, so both sides get the same food
 * @param {'host'|'guest'} options.localRole
 * @param {(state:object)=>void} options.onState
 */
export function createLockstep({ seed, localRole, onState }) {
  let state = createState(seed, 2)
  // tick -> { host: dir|null, guest: dir|null }
  const inputs = new Map()
  const sentFor = new Set()
  const remoteRole = localRole === 'host' ? 'guest' : 'host'

  let pending = null
  let stalledSince = null
  // The next tick this player still owes an input for. It advances by one per
  // input, independently of how many ticks the simulation managed to step -
  // deriving it from state.tick instead leaves gaps the moment advance()
  // covers more than one tick at once, and a single missing tick stalls the
  // game permanently because it can never be filled retrospectively.
  let nextInputTick = INPUT_DELAY + 1

  function record(tick, role, dir) {
    if (!inputs.has(tick)) inputs.set(tick, {})
    const slot = inputs.get(tick)
    // First value wins: a duplicate is a resend, not a change of mind, and
    // honouring the second copy would desync the two machines.
    if (!(role in slot)) slot[role] = dir ?? null
  }

  function haveBoth(tick) {
    const slot = inputs.get(tick)
    return Boolean(slot && 'host' in slot && 'guest' in slot)
  }

  // The opening ticks have nobody's input yet, so seed both sides with nulls
  // up to the delay - otherwise the game could never take its first step.
  for (let tick = 1; tick <= INPUT_DELAY; tick++) {
    record(tick, 'host', null)
    record(tick, 'guest', null)
  }

  return {
    /** Queue a direction; it takes effect INPUT_DELAY ticks from now. */
    steer(direction) {
      pending = direction
    },

    /** An input that arrived from the peer. */
    receive(tick, role, dir) {
      record(tick, role, dir)
    },

    /**
     * Called once per tick boundary. Returns every input message still owed to
     * the peer - usually one, but more if the simulation just advanced several
     * ticks at once. Returning an array rather than a single message is what
     * guarantees the input stream has no holes in it.
     */
    commit() {
      const messages = []
      const upTo = state.tick + INPUT_DELAY + 1

      while (nextInputTick <= upTo) {
        const tick = nextInputTick++
        if (sentFor.has(tick)) continue
        sentFor.add(tick)
        // Only the furthest-out tick carries the pending steer; the ticks
        // being backfilled are ones the player has already lived through.
        const dir = tick === upTo ? pending : null
        if (tick === upTo) pending = null
        record(tick, localRole, dir)
        messages.push({ t: tick, d: dir, r: localRole })
      }
      return messages
    },

    /**
     * Advances as far as the inputs allow. Stopping when a tick is missing its
     * other half is the mechanism that keeps the two machines on the same
     * tick - the stall is the feature, not a fault.
     */
    advance() {
      let stepped = false
      while (state.status !== 'over' && haveBoth(state.tick + 1)) {
        const slot = inputs.get(state.tick + 1)
        state = step(state, {
          [HOST_SEAT]: slot.host ?? null,
          [GUEST_SEAT]: slot.guest ?? null,
        })
        inputs.delete(state.tick)
        stepped = true
      }

      if (stepped) {
        stalledSince = null
        onState?.(state)
      } else if (state.status !== 'over' && stalledSince === null) {
        stalledSince = performance.now()
      }
      return stepped
    },

    /** How long this machine has been waiting on the peer, in ms. */
    stalledFor() {
      return stalledSince === null ? 0 : performance.now() - stalledSince
    },

    /** Which engine seat this player occupies. */
    get localSeat() {
      return localRole === 'host' ? HOST_SEAT : GUEST_SEAT
    },

    get remoteRole() {
      return remoteRole
    },

    get state() {
      return state
    },
  }
}
