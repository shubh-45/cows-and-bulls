// Pure Tic-Tac-Toe rules - no React in here, so the game can be reasoned
// about and tested on its own, and the online mode can replay a move list
// through exactly the same code the offline mode uses.

export const EMPTY = 0
export const X = 1
export const O = 2
export const SIZE = 3
export const CELLS = SIZE * SIZE

// A flat 9-cell array rather than a nested one, because the rooms API
// addresses squares by a single flattened index - so a move needs no
// translation on its way to or from the server.
export function createBoard() {
  return Array(CELLS).fill(EMPTY)
}

export function opponent(player) {
  return player === X ? O : X
}

// The eight ways to make three in a row: rows, columns, diagonals.
export const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
]

/** Returns `{ player, line }` for a completed line, or null if nobody has won. */
export function winnerOf(board) {
  for (const line of LINES) {
    const [a, b, c] = line
    if (board[a] !== EMPTY && board[a] === board[b] && board[a] === board[c]) {
      return { player: board[a], line }
    }
  }
  return null
}

export function legalMoves(board) {
  const moves = []
  for (let i = 0; i < CELLS; i++) {
    if (board[i] === EMPTY) moves.push(i)
  }
  return moves
}

export function isFull(board) {
  return board.every((cell) => cell !== EMPTY)
}

/** Returns a new board so React sees a changed reference. */
export function applyMove(board, index, player) {
  const next = [...board]
  next[index] = player
  return next
}

/* ---- AI ---------------------------------------------------------------- */

// Depth is folded into the score so the AI prefers winning sooner and losing
// later - without it, every winning line looks equally good and the AI will
// happily dawdle while the human gets a chance to escape.
function minimax(board, current, aiPlayer, depth) {
  const result = winnerOf(board)
  if (result) {
    return { score: result.player === aiPlayer ? 10 - depth : depth - 10, index: null }
  }
  if (isFull(board)) return { score: 0, index: null }

  const maximizing = current === aiPlayer
  let best = { score: maximizing ? -Infinity : Infinity, index: null }

  for (const index of legalMoves(board)) {
    const { score } = minimax(applyMove(board, index, current), opponent(current), aiPlayer, depth + 1)
    if (maximizing ? score > best.score : score < best.score) {
      best = { score, index }
    }
  }
  return best
}

export function bestMove(board, aiPlayer) {
  return minimax(board, aiPlayer, aiPlayer, 0).index
}

function randomMove(board) {
  const moves = legalMoves(board)
  return moves.length ? moves[Math.floor(Math.random() * moves.length)] : null
}

/**
 * Tic-Tac-Toe is a solved game: two perfect players always draw, so an AI
 * that never errs makes every single game end level. That is precisely the
 * opposite of rewarding, which is why "hard" is not the default and why the
 * lower tiers deliberately blunder.
 *
 *   easy   - plays at random; wins happen often
 *   medium - plays well most of the time, but blunders often enough that a
 *            thoughtful player beats it
 *   hard   - perfect play; the best a human can achieve is a draw
 */
export const DIFFICULTY_BLUNDER_RATE = { easy: 1, medium: 0.35, hard: 0 }

export function chooseAiMove(board, aiPlayer, difficulty = 'medium') {
  if (legalMoves(board).length === 0) return null

  const blunderRate = DIFFICULTY_BLUNDER_RATE[difficulty] ?? DIFFICULTY_BLUNDER_RATE.medium
  if (Math.random() < blunderRate) {
    return randomMove(board)
  }
  return bestMove(board, aiPlayer)
}

/* ---- online play ------------------------------------------------------- */

// The server stores an ordered move list, never a board. Both players rebuild
// the position by replaying that list, so the two screens cannot disagree and
// the server needs no copy of the rules.
//
// X always moves first by the rules of the game, so the mark follows whoever
// is starting this match rather than being pinned to host/guest. The room
// alternates the start between matches so a series stays fair.
export function markForRole(role, startingRole = 'host') {
  return role === startingRole ? X : O
}

export function replayMoves(moves, startingRole = 'host') {
  let board = createBoard()
  for (const move of moves) {
    board = applyMove(board, move.index, markForRole(move.role, startingRole))
  }

  const result = winnerOf(board)
  const full = isFull(board)
  // X always moves on even-numbered turns, so the move count alone says whose
  // turn it is - there is no pass rule to complicate it.
  const player = moves.length % 2 === 0 ? X : O

  return { board, player, winner: result, over: Boolean(result) || full }
}
