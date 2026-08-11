// Every function here just wraps a fetch() call. Keeping them in one file
// means components never need to know URLs or HTTP details - they just
// call startNewGame() / submitGuess() and get plain JS objects back.

const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080'

async function handleResponse(res) {
  const data = await res.json()
  if (!res.ok) {
    // Our Spring Boot GlobalExceptionHandler always sends { error: "..." }
    throw new Error(data.error || 'Something went wrong')
  }
  return data
}

export async function startNewGame() {
  const res = await fetch(`${BASE_URL}/api/games`, { method: 'POST' })
  return handleResponse(res)
}

export async function submitGuess(gameId, guess) {
  const res = await fetch(`${BASE_URL}/api/games/${gameId}/guesses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ guess }),
  })
  return handleResponse(res)
}
