// Explicit .js so this module can be imported by plain Node as well as Vite.
import { TICK_MS, createState, step } from './engine.js'

export { TICK_MS }

// One browser referees; both play without waiting for anyone. Same model as the
// Snake duel, which is where it was proved - the referee simulates on its own
// clock and never blocks, and the guest plays its own tank immediately and is
// corrected towards the referee's word.
//
// Tanks differ from Snake in one way that matters. Snake's input is a discrete
// turn, so a missing packet means "carry straight on" and costs nothing. Here
// the input is continuous - a drive, a steer and an aim held down across many
// ticks - so a dropped packet must HOLD the last input rather than fall back to
// zero. Falling back would make the other tank stutter to a halt every time the
// network hiccuped.

export const PROTOCOL_VERSION = 1
export const HOST_SEAT = 0
export const GUEST_SEAT = 1

/** How far back the referee will redo history to honour a late input. */
const MAX_REWIND = 4
/** States and inputs kept, a little more than MAX_REWIND. */
const HISTORY = 12
/** How far the guest's own clock may run past the referee's last word. */
const MAX_LEAD = 3

const NEUTRAL = { drive: 0, steer: 0, aim: null, fire: false }

/**
 * @param {object} options
 * @param {number} options.seed shared, so both sides build the same arena
 * @param {'host'|'guest'} options.role
 * @param {(state:object)=>void} options.onState
 * @param {(msg:object)=>void} options.send
 */
export function createDuel({ seed, role, onState, send }) {
  const isHost = role === 'host'
  const localSeat = isHost ? HOST_SEAT : GUEST_SEAT
  const otherSeat = isHost ? GUEST_SEAT : HOST_SEAT

  let state = createState(seed)
  /** Guest only: the referee's last word, which the local clock predicts from. */
  let auth = state
  let localTick = 0

  /** Host: the state at each tick, and the inputs that produced it, for rewind. */
  const past = new Map([[0, state]])
  const applied = new Map()
  /** Host: guest inputs tagged for ticks not yet reached. */
  const scheduled = new Map()
  /** Guest: this player's own inputs, replayed when predicting forward. */
  const mine = new Map()

  let myInput = { ...NEUTRAL }
  /** Held so a dropped packet does not stop the other tank dead. */
  let heldRemote = { ...NEUTRAL }
  /** Guest: the opponent's last known input, for predicting their tank. */
  let heldOther = { ...NEUTRAL }

  let started = isHost
  let tickStartedAt = now()
  let lastWordAt = now()

  function now() {
    return typeof performance !== 'undefined' ? performance.now() : Date.now()
  }

  function prune(upTo) {
    for (const k of past.keys()) if (k < upTo - HISTORY) past.delete(k)
    for (const k of applied.keys()) if (k < upTo - HISTORY) applied.delete(k)
    for (const k of mine.keys()) if (k < upTo - HISTORY) mine.delete(k)
    for (const k of scheduled.keys()) if (k < upTo - HISTORY) scheduled.delete(k)
  }

  // Field names are spelled out rather than squeezed to one letter. The first
  // version used `k` for both the message kind and the tank array, and the
  // spread silently overwrote the kind - so every snapshot arrived unrecognised
  // and the guest simply stopped advancing.
  /** Rounded hard: a snapshot goes out thirty times a second. */
  const pack = (s, withGrid) => ({
    t: s.tick,
    st: s.status,
    w: s.winner,
    tk: s.tanks.map((t) => [
      Math.round(t.x * 100) / 100, Math.round(t.y * 100) / 100,
      Math.round(t.heading * 1000) / 1000, Math.round(t.turret * 1000) / 1000,
      t.alive ? 1 : 0, t.cooldown,
    ]),
    sh: s.shells.map((b) => [
      b.id, b.owner,
      Math.round(b.x * 100) / 100, Math.round(b.y * 100) / 100,
      Math.round(b.vx * 10) / 10, Math.round(b.vy * 10) / 10,
      b.bounces, b.life,
    ]),
    ev: s.events,
    // The grid rarely changes, so it rides along only when it has. Sending 330
    // cells thirty times a second would be most of the bandwidth for nothing.
    ...(withGrid ? { gr: s.grid } : {}),
  })

  function unpack(msg, fallbackGrid) {
    return {
      tick: msg.t,
      status: msg.st,
      winner: msg.w ?? null,
      seed,
      rngState: seed >>> 0,
      grid: msg.gr ?? fallbackGrid,
      tanks: msg.tk.map((a, i) => ({
        id: i, x: a[0], y: a[1], heading: a[2], turret: a[3],
        alive: a[4] === 1, cooldown: a[5], shots: 0,
      })),
      shells: msg.sh.map((b) => ({
        id: b[0], owner: b[1], x: b[2], y: b[3], vx: b[4], vy: b[5],
        bounces: b[6], life: b[7],
      })),
      nextShellId: 1,
      events: msg.ev ?? [],
    }
  }

  /** True when this tick actually changed the arena. */
  const gridTouched = (s) =>
    s.events.some((e) => e.e === 'crate-hit' || e.e === 'crate-break' || e.e === 'blast')

  function broadcast(withGrid) {
    send?.({ k: 'S', v: PROTOCOL_VERSION, ...pack(state, withGrid) })
  }

  /** Guest: replay from the referee's word up to this client's own tick. */
  function rebuild() {
    let s = auth
    for (let t = auth.tick + 1; t <= localTick; t++) {
      s = step(s, {
        [localSeat]: mine.get(t) ?? NEUTRAL,
        // The opponent's input is never sent to us, so their tank is predicted
        // as "carrying on". One tick of that is about a unit of arena.
        [otherSeat]: heldOther,
      })
    }
    // A predicted death is not a result - only the referee ends a round.
    if (auth.status !== 'over' && s.status === 'over') s = auth
    state = s
  }

  return {
    /** Advance one tick of real time. */
    tick() {
      if (isHost) {
        if (state.status === 'over') return
        const target = state.tick + 1
        if (scheduled.has(target)) heldRemote = scheduled.get(target)
        const inputs = { [HOST_SEAT]: myInput, [GUEST_SEAT]: heldRemote }
        applied.set(target, inputs)
        scheduled.delete(target)

        state = step(state, inputs)
        past.set(state.tick, state)
        // Firing is an edge, not a state. Left set, a held input would empty
        // the magazine on its own every time the reload finished.
        myInput = { ...myInput, fire: false }
        heldRemote = { ...heldRemote, fire: false }
        tickStartedAt = now()
        prune(state.tick)
        broadcast(gridTouched(state))
        onState?.(state)
        return
      }

      if (auth.status === 'over') return
      if (localTick - auth.tick >= MAX_LEAD) return
      localTick += 1
      mine.set(localTick, { ...myInput })
      send?.({ k: 'I', v: PROTOCOL_VERSION, t: localTick, i: myInput })
      myInput = { ...myInput, fire: false }
      rebuild()
      tickStartedAt = now()
      prune(localTick)
      onState?.(state)
    },

    /** Merge into this player's held input. `fire` is consumed by the next tick. */
    setInput(partial) {
      myInput = { ...myInput, ...partial }
    },

    /** Re-send the current state, for when the pair re-forms. */
    resync() {
      if (isHost) broadcast(true)
    },

    receive(msg) {
      if (!msg || msg.v !== PROTOCOL_VERSION) return

      if (msg.k === 'S' && !isHost) {
        if (msg.t < auth.tick) return
        const wasStarted = started
        auth = unpack(msg, auth.grid)
        started = true
        lastWordAt = now()
        if (!wasStarted || auth.tick > localTick) localTick = auth.tick
        if (auth.status === 'over') { localTick = auth.tick; mine.clear() }
        rebuild()
        onState?.(state)
        return
      }

      if (msg.k === 'I' && isHost) {
        const target = msg.t
        if (state.status === 'over') return
        if (target > state.tick) { scheduled.set(target, msg.i); return }
        if (target < state.tick - MAX_REWIND) return

        // Late, but recent enough to honour at the tick it was meant for, so
        // the guest's own prediction stays true rather than being corrected.
        const base = past.get(target - 1)
        if (!base) return
        let redone = base
        for (let t = target; t <= state.tick; t++) {
          const inputs = { ...(applied.get(t) ?? {}) }
          if (t === target) inputs[GUEST_SEAT] = msg.i
          else if (t > target) inputs[GUEST_SEAT] = { ...msg.i, fire: false }
          applied.set(t, inputs)
          redone = step(redone, inputs)
          past.set(t, redone)
          if (redone.status === 'over') break
        }
        state = redone
        heldRemote = { ...msg.i, fire: false }
        broadcast(true)
        onState?.(state)
      }
    },

    /** Nudged on the guest to hold a one-tick lead on the referee. */
    tickInterval() {
      if (isHost) return TICK_MS
      const lead = localTick - auth.tick
      if (lead > 1) return TICK_MS * 1.08
      if (lead < 1) return TICK_MS * 0.92
      return TICK_MS
    },

    /** 0..1 through the current tick, for drawing between them. */
    progress() {
      const t = (now() - tickStartedAt) / TICK_MS
      return t < 0 ? 0 : t > 1 ? 1 : t
    },

    silentFor() {
      return isHost || !started ? 0 : now() - lastWordAt
    },

    get localSeat() { return localSeat },
    get isHost() { return isHost },
    get state() { return state },
  }
}
