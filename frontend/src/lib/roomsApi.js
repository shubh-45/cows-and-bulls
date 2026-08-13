// Client for the friends-only room API. Same base URL as the Cows & Bulls
// client, so both talk to the one Spring service.

const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080'

async function handle(response) {
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(data.error || 'Something went wrong. Please try again.')
  }
  return data
}

export function createRoom({ gameType, playerId, playerName }) {
  return fetch(`${BASE_URL}/api/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameType, playerId, playerName }),
  }).then(handle)
}

export function joinRoom(code, { playerId, playerName }) {
  return fetch(`${BASE_URL}/api/rooms/${encodeURIComponent(code)}/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerId, playerName }),
  }).then(handle)
}

export function fetchRoom(code, playerId) {
  const query = new URLSearchParams({ playerId })
  return fetch(`${BASE_URL}/api/rooms/${encodeURIComponent(code)}?${query}`).then(handle)
}

// nextPlayerId and gameOver come from the client because only the client
// knows the rules - Reversi skips a player with no legal move, and the
// server does not implement the game.
export function sendMove(code, { playerId, index, nextPlayerId, gameOver, resultNote }) {
  return fetch(`${BASE_URL}/api/rooms/${encodeURIComponent(code)}/moves`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerId, index, nextPlayerId, gameOver, resultNote }),
  }).then(handle)
}

export function forfeitRoom(code, playerId) {
  const query = new URLSearchParams({ playerId })
  return fetch(`${BASE_URL}/api/rooms/${encodeURIComponent(code)}/forfeit?${query}`, {
    method: 'POST',
  }).then(handle)
}

// The free Render instance sleeps after ~15 minutes idle and takes 30-60s to
// wake. Firing this when the lobby opens means the wake-up overlaps with the
// player reading the screen, instead of stalling their first click.
export function wakeBackend() {
  return fetch(`${BASE_URL}/`, { method: 'GET' }).catch(() => {
    /* best effort - a failure here just means the first real call waits */
  })
}
