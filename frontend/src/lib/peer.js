// A direct browser-to-browser data channel, negotiated through the room API.
//
// The server's only job is to pass a handful of handshake messages between the
// two players. Once the channel opens it stops being involved entirely: the
// game runs peer to peer, which is what makes a real-time duel possible on an
// instance that sleeps and meters its hours.

const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080'

// Public STUN only. STUN just tells a browser how it looks from the outside,
// which is enough for most networks. The ~10-15% behind symmetric NAT would
// need a TURN relay, and there isn't a free one - those players fall back to
// the non-contact duel instead.
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
]

const SIGNAL_POLL_MS = 700
/** Give up and fall back rather than leaving someone on a spinner forever. */
const CONNECT_TIMEOUT_MS = 20000

async function postSignal(code, playerId, kind, payload) {
  await fetch(`${BASE_URL}/api/rooms/${encodeURIComponent(code)}/signals`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerId, kind, payload: JSON.stringify(payload) }),
  })
}

async function readSignals(code, playerId, since) {
  const query = new URLSearchParams({ playerId, since: String(since) })
  const response = await fetch(
    `${BASE_URL}/api/rooms/${encodeURIComponent(code)}/signals?${query}`
  )
  if (!response.ok) throw new Error('signal read failed')
  return response.json()
}

/**
 * @param {object} options
 * @param {string} options.code room code
 * @param {string} options.playerId
 * @param {boolean} options.isHost the host creates the channel and offers
 * @param {(msg:any)=>void} options.onMessage
 * @param {(status:'connecting'|'connected'|'failed'|'closed')=>void} options.onStatus
 */
export function createPeer({ code, playerId, isHost, onMessage, onStatus }) {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
  let channel = null
  let cursor = 0
  let live = true
  let settled = false
  // ICE candidates can arrive before the remote description is set, and
  // applying one early throws - so they wait here until there's somewhere to
  // put them.
  const pendingCandidates = []

  const report = (status) => {
    if (!live) return
    onStatus?.(status)
  }

  function attachChannel(dataChannel) {
    channel = dataChannel
    channel.onopen = () => {
      settled = true
      report('connected')
    }
    channel.onclose = () => report('closed')
    channel.onmessage = (event) => {
      try {
        onMessage?.(JSON.parse(event.data))
      } catch {
        /* ignore anything that isn't ours */
      }
    }
  }

  pc.onicecandidate = (event) => {
    if (event.candidate && live) {
      postSignal(code, playerId, 'candidate', event.candidate).catch(() => {})
    }
  }

  pc.onconnectionstatechange = () => {
    if (!live) return
    if (pc.connectionState === 'failed') report('failed')
  }

  // The guest never creates a channel; it receives the host's.
  pc.ondatachannel = (event) => attachChannel(event.channel)

  async function applyPending() {
    while (pendingCandidates.length) {
      const candidate = pendingCandidates.shift()
      try {
        await pc.addIceCandidate(candidate)
      } catch {
        /* a candidate that no longer applies is not fatal */
      }
    }
  }

  async function handleSignal(signal) {
    const payload = JSON.parse(signal.payload)

    if (signal.kind === 'offer') {
      await pc.setRemoteDescription(payload)
      await applyPending()
      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)
      await postSignal(code, playerId, 'answer', answer)
      return
    }
    if (signal.kind === 'answer') {
      await pc.setRemoteDescription(payload)
      await applyPending()
      return
    }
    if (signal.kind === 'candidate') {
      if (pc.remoteDescription) {
        try {
          await pc.addIceCandidate(payload)
        } catch {
          /* ignore */
        }
      } else {
        pendingCandidates.push(payload)
      }
    }
  }

  async function poll() {
    while (live && !settled) {
      try {
        const batch = await readSignals(code, playerId, cursor)
        cursor = batch.cursor
        for (const signal of batch.signals) {
          if (!live) return
          await handleSignal(signal)
        }
      } catch {
        /* transient - the next poll will pick it up */
      }
      await new Promise((resolve) => setTimeout(resolve, SIGNAL_POLL_MS))
    }
  }

  async function start() {
    report('connecting')
    if (isHost) {
      // Ordered and reliable: lockstep cannot tolerate a dropped or
      // out-of-order input, and the traffic is far too small for the
      // usual reasons to prefer unreliable delivery to apply.
      attachChannel(pc.createDataChannel('snake', { ordered: true }))
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      await postSignal(code, playerId, 'offer', offer)
    }
    poll()

    setTimeout(() => {
      if (live && !settled) report('failed')
    }, CONNECT_TIMEOUT_MS)
  }

  start().catch(() => report('failed'))

  return {
    send(message) {
      if (channel?.readyState === 'open') {
        channel.send(JSON.stringify(message))
        return true
      }
      return false
    },
    close() {
      live = false
      try {
        channel?.close()
        pc.close()
      } catch {
        /* already gone */
      }
    },
    get connected() {
      return channel?.readyState === 'open'
    },
  }
}
