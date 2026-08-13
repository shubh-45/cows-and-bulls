// Everything about "who is playing" lives in the browser. No accounts, no
// passwords, no server: a random id plus a display name in localStorage.
//
// This is a deliberate trade. It costs nothing to run, survives the backend
// spinning down, and works offline - but it is per-device, and clearing site
// data resets it. That's why exportProfile/importProfile exist: they let a
// player carry their identity to another browser by hand.

const STORAGE_KEY = 'arcade.profile.v1'

export const MAX_NAME_LENGTH = 16

function randomId() {
  // crypto.randomUUID needs a secure context; localhost and https both
  // qualify, but fall back rather than throw if it's ever missing.
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  return `p_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
}

export function sanitizeName(raw) {
  return String(raw ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME_LENGTH)
}

export function createProfile(name) {
  return {
    id: randomId(),
    name: sanitizeName(name) || 'Player',
    createdAt: new Date().toISOString(),
    stats: {},
  }
}

// Every read is defensive: localStorage can be unavailable (Safari private
// mode throws on access) or hold something a previous version wrote, and a
// games hub should never white-screen because of a bad stored value.
export function loadProfile() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || !parsed.id) return null
    return { ...parsed, stats: parsed.stats ?? {} }
  } catch {
    return null
  }
}

export function saveProfile(profile) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile))
  } catch {
    // Quota exceeded or storage blocked - the game still plays fine, the
    // player just won't keep stats. Not worth interrupting them over.
  }
  return profile
}

export function clearProfile() {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* nothing to do */
  }
}

/* ---- stats ----------------------------------------------------------- */

// Stats are namespaced per game id so games never tread on each other:
// stats: { wordle: { played, wins, streak, bestStreak, best }, ... }
export function emptyStats() {
  return { played: 0, wins: 0, streak: 0, bestStreak: 0, best: null }
}

export function getGameStats(profile, gameId) {
  return { ...emptyStats(), ...(profile?.stats?.[gameId] ?? {}) }
}

// `won` drives the streak. `score` is whatever that game measures - guesses
// used, moves taken, seconds elapsed - and `lowerIsBetter` says which
// direction counts as an improvement, since "3 guesses" and "64 discs" want
// opposite comparisons.
export function recordResult(profile, gameId, { won, score = null, lowerIsBetter = true }) {
  const prev = getGameStats(profile, gameId)

  const streak = won ? prev.streak + 1 : 0
  let best = prev.best
  if (won && score !== null) {
    const improved = best === null || (lowerIsBetter ? score < best : score > best)
    if (improved) best = score
  }

  const next = {
    played: prev.played + 1,
    wins: prev.wins + (won ? 1 : 0),
    streak,
    bestStreak: Math.max(prev.bestStreak, streak),
    best,
  }

  return saveProfile({
    ...profile,
    stats: { ...(profile.stats ?? {}), [gameId]: next },
  })
}

/* ---- moving between devices ------------------------------------------ */

// A copyable string rather than a file, so it works on a phone. btoa only
// handles latin1, so encode to UTF-8 bytes first or a non-ASCII name throws.
export function exportProfile(profile) {
  const json = JSON.stringify(profile)
  const bytes = new TextEncoder().encode(json)
  return btoa(String.fromCharCode(...bytes))
}

export function importProfile(code) {
  try {
    const binary = atob(code.trim())
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
    const parsed = JSON.parse(new TextDecoder().decode(bytes))
    if (!parsed?.id || !parsed?.name) return null
    return { ...parsed, stats: parsed.stats ?? {} }
  } catch {
    return null
  }
}
