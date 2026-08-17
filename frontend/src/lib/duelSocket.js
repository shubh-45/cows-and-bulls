// The Snake duel's transport: a WebSocket to the room relay.
//
// This replaced a WebRTC data channel, which could not work across networks.
// STUN alone never yields a relay candidate, every free public TURN service has
// shut down, and mobile carriers are all behind carrier-grade NAT - so the two
// browsers had no path to each other and the handshake always failed.
//
// Relaying costs nothing that matters here. Lockstep's steering feel is fixed
// by INPUT_DELAY * TICK_MS (380ms) on the client whatever the transport;
// latency decides only whether the game STALLS, never how responsive it feels.
// A hop through the Singapore instance measures ~158ms, comfortably inside that
// budget, so a relayed duel plays like a direct one and connects every time.

// `import.meta.env` is Vite's, and is absent under plain Node - guarded so this
// module can be exercised outside a browser, the same reason lockstep.js spells
// out its ./engine.js import. The transport is the part most worth testing for
// real, and a test that reimplements it proves nothing.
const ENV = import.meta.env ?? {}
const BASE_URL = ENV.VITE_API_BASE_URL || 'http://localhost:8080'
// https -> wss, http -> ws. Getting this wrong on a deployed site is a mixed
// content error the browser blocks outright.
const socketUrlFor = (baseUrl) => `${baseUrl.replace(/^http/, 'ws')}/ws/duel`

/** Bare token, matched by the server without parsing. Cloudflare closes a
    socket silent for ~100s, which is exactly what the lobby looks like. */
const KEEPALIVE = 'ka'
const KEEPALIVE_MS = 25000

const RECONNECT_MS = [600, 1200, 2400, 4000]
/** After this many failed attempts the instance is probably cold, not broken. */
const WAKING_AFTER_ATTEMPTS = 2

const PING_COUNT = 3
const PING_SPACING_MS = 250

/**
 * @param {object} options
 * @param {string} options.code room code
 * @param {string} options.playerId
 * @param {(msg:any)=>void} options.onMessage game messages from the opponent
 * @param {(status:'connecting'|'waking'|'waiting'|'connected'|'reconnecting'|'rejected'|'closed', detail:object)=>void} options.onStatus
 */
export function createDuelLink({ code, playerId, onMessage, onStatus, baseUrl = BASE_URL }) {
  const socketUrl = socketUrlFor(baseUrl)
  let socket = null
  let live = true
  let attempts = 0
  let everConnected = false
  let rtt = null
  let keepaliveTimer = null
  let reconnectTimer = null
  let status = 'connecting'

  /**
   * Every input this client has sent for the current match.
   *
   * This is what makes a duel survive a dropped connection. Lockstep can never
   * fill a missing tick retrospectively - one lost input freezes the match
   * permanently - and while a socket is down the relay simply discards frames
   * aimed at it. So inputs are kept and re-sent wholesale whenever the pair is
   * re-established. Duplicates are free: lockstep's record() keeps the first
   * value for a tick and ignores the rest, precisely so a resend is harmless.
   */
  let history = []

  const report = (next) => {
    if (!live) return
    status = next
    onStatus?.(next, { attempts, rtt })
  }

  function rawSend(text) {
    if (socket?.readyState !== WebSocket.OPEN) return false
    try {
      socket.send(text)
      return true
    } catch {
      return false
    }
  }

  /* ---- round-trip measurement ----
     The timestamp is this client's own clock echoed back by the peer, so no
     clock synchronisation is involved. Reported for diagnostics: a duel that
     stalls should be able to say why. */

  function measureRtt() {
    for (let i = 0; i < PING_COUNT; i++) {
      setTimeout(() => {
        if (!live) return
        rawSend(JSON.stringify({ k: 'p', t: Math.round(performance.now()) }))
      }, i * PING_SPACING_MS)
    }
    // Replies are collected in handleMessage; re-report once they have landed
    // so the screen can show the measured latency.
    setTimeout(() => {
      if (live && rtt !== null) report(status)
    }, PING_COUNT * PING_SPACING_MS + 400)
  }

  function handleMessage(raw) {
    if (raw === KEEPALIVE) return

    let msg
    try {
      msg = JSON.parse(raw)
    } catch {
      return
    }
    if (!msg || typeof msg !== 'object') return

    if (msg.k === 'sys') {
      if (msg.e === 'ready') {
        everConnected = true
        attempts = 0
        report('connected')
        // Re-send the match so far. On the first pairing history is empty, so
        // this costs nothing; after a reconnect it is what unfreezes the game.
        for (const sent of history) rawSend(JSON.stringify(sent))
        measureRtt()
      } else if (msg.e === 'waiting') {
        report('waiting')
      } else if (msg.e === 'peer-left') {
        report('waiting')
      }
      return
    }

    // Latency probes are ours, not the game's.
    if (msg.k === 'p') {
      rawSend(JSON.stringify({ k: 'q', t: msg.t }))
      return
    }
    if (msg.k === 'q') {
      const sample = Math.round(performance.now() - msg.t)
      rtt = rtt === null ? sample : Math.min(rtt, sample)
      return
    }

    onMessage?.(msg)
  }

  function scheduleReconnect() {
    if (!live) return
    const wait = RECONNECT_MS[Math.min(attempts, RECONNECT_MS.length - 1)]
    attempts += 1
    clearTimeout(reconnectTimer)
    reconnectTimer = setTimeout(connect, wait)
    // A first connection that has not landed yet is usually the free instance
    // waking up (30-60s), which deserves different wording from a match that
    // has dropped mid-play.
    if (everConnected) report('reconnecting')
    else report(attempts > WAKING_AFTER_ATTEMPTS ? 'waking' : 'connecting')
  }

  function connect() {
    if (!live) return
    const query = new URLSearchParams({ code, playerId })
    let next
    try {
      next = new WebSocket(`${socketUrl}?${query}`)
    } catch {
      scheduleReconnect()
      return
    }
    socket = next

    next.onopen = () => {
      if (!live || socket !== next) return
      // Not 'connected' yet - that waits for the server to confirm both seats
      // are filled, which is the condition the match actually needs.
      report(everConnected ? 'reconnecting' : 'connecting')
      clearInterval(keepaliveTimer)
      keepaliveTimer = setInterval(() => rawSend(KEEPALIVE), KEEPALIVE_MS)
    }

    next.onmessage = (event) => {
      if (live && socket === next) handleMessage(event.data)
    }

    next.onclose = (event) => {
      if (!live || socket !== next) return
      clearInterval(keepaliveTimer)
      // 4004: the server says this player is not in this room. Retrying cannot
      // help, and hammering a rejection would be rude to a sleeping instance.
      if (event.code === 4004) {
        report('rejected')
        live = false
        return
      }
      scheduleReconnect()
    }

    next.onerror = () => {
      /* onclose always follows; the retry is handled there. */
    }
  }

  connect()

  return {
    /** Queues nothing and guarantees nothing on its own - delivery is
        guaranteed by the history replay above, not by this call. */
    send(message) {
      if (message?.k === 'i') history.push(message)
      return rawSend(JSON.stringify(message))
    },

    /** Called when a new match starts, so a rematch does not replay the
        previous match's inputs into a fresh simulation. */
    resetHistory() {
      history = []
      rtt = null
    },

    close() {
      live = false
      clearInterval(keepaliveTimer)
      clearTimeout(reconnectTimer)
      try {
        socket?.close(1000, 'left')
      } catch {
        /* already gone */
      }
      socket = null
    },

    get connected() {
      return status === 'connected'
    },

    get rtt() {
      return rtt
    },
  }
}
