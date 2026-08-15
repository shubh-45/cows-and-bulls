// Pure Reversi/Othello rules - no React in here, so the interesting part of
// the game (legal moves and flipping) can be reasoned about, and tested, on
// its own. The component only decides *when* to call these.

export const EMPTY = 0
export const BLACK = 1
export const WHITE = 2
export const SIZE = 8

// all eight compass directions as [rowDelta, colDelta]
const DIRECTIONS = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1], [0, 1],
  [1, -1], [1, 0], [1, 1],
]

export function opponent(player) {
  return player === BLACK ? WHITE : BLACK
}

// Standard opening: White on d4/e5, Black on e4/d5 - the two colors facing
// each other diagonally. Board is indexed [row][col] with row = rank - 1
// and col = file (a=0), so d4 is [3][3] and e5 is [4][4].
export function createBoard() {
  const board = Array.from({ length: SIZE }, () => Array(SIZE).fill(EMPTY))
  board[3][3] = WHITE
  board[3][4] = BLACK
  board[4][3] = BLACK
  board[4][4] = WHITE
  return board
}

function inBounds(row, col) {
  return row >= 0 && row < SIZE && col >= 0 && col < SIZE
}

// Walk outward from a candidate square in one direction, collecting an
// unbroken run of opponent discs. The run only counts if it's capped by one
// of the mover's own discs - an empty square or the board edge means
// nothing is outflanked, so the run is discarded.
export function flipsInDirection(board, row, col, player, rowStep, colStep) {
  const foe = opponent(player)
  const captured = []
  let r = row + rowStep
  let c = col + colStep

  while (inBounds(r, c) && board[r][c] === foe) {
    captured.push([r, c])
    r += rowStep
    c += colStep
  }

  const cappedByOwn = inBounds(r, c) && board[r][c] === player
  return cappedByOwn ? captured : []
}

// Every disc this move would flip, summed across all eight directions. An
// empty result means the move is illegal - outflanking at least one disc is
// exactly what makes a move legal.
export function flipsForMove(board, row, col, player) {
  if (board[row][col] !== EMPTY) return []

  const flips = []
  for (const [rowStep, colStep] of DIRECTIONS) {
    flips.push(...flipsInDirection(board, row, col, player, rowStep, colStep))
  }
  return flips
}

export function legalMoves(board, player) {
  const moves = []
  for (let row = 0; row < SIZE; row++) {
    for (let col = 0; col < SIZE; col++) {
      const flips = flipsForMove(board, row, col, player)
      if (flips.length > 0) moves.push({ row, col, flips })
    }
  }
  return moves
}

// Returns a new board rather than mutating, so React sees a changed
// reference and previous boards stay intact.
export function applyMove(board, row, col, player, flips) {
  const next = board.map((r) => [...r])
  next[row][col] = player
  for (const [r, c] of flips) next[r][c] = player
  return next
}

export function countDiscs(board) {
  let black = 0
  let white = 0
  for (const row of board) {
    for (const cell of row) {
      if (cell === BLACK) black += 1
      else if (cell === WHITE) white += 1
    }
  }
  return { black, white }
}

// Whose turn is next. A player with no legal move is skipped; if neither
// side can move the game is over - usually because the board is full, but
// it can happen earlier when both sides are blocked.
export function nextTurn(board, justMoved) {
  const other = opponent(justMoved)
  if (legalMoves(board, other).length > 0) {
    return { player: other, passed: false, over: false }
  }
  if (legalMoves(board, justMoved).length > 0) {
    return { player: justMoved, passed: true, over: false }
  }
  return { player: justMoved, passed: false, over: true }
}

/* ---- online play ------------------------------------------------------ */

// The server stores an ordered list of moves, never a board. Both players
// rebuild the position by replaying that list through the rules below, so
// two clients can never disagree about what the board looks like and the
// server never needs a copy of the game's rules.
//
// Black always moves first, so the colour follows whoever is starting this
// match rather than being pinned to host/guest. The room alternates the start
// between matches, which is what stops a series being lopsided in favour of
// whoever happened to create the room.
export function colorForRole(role, startingRole = 'host') {
  return role === startingRole ? BLACK : WHITE
}

export function indexToCell(index) {
  return { row: Math.floor(index / SIZE), col: index % SIZE }
}

export function cellToIndex(row, col) {
  return row * SIZE + col
}

/**
 * Replays `moves` (each `{ index, role }`, in order) onto a fresh board.
 * Returns the resulting board plus whose turn it is next, honouring the
 * pass rule - so a player with no legal move is skipped exactly as in the
 * local game.
 */
export function replayMoves(moves, startingRole = 'host') {
  let board = createBoard()
  let lastPlayer = null

  for (const move of moves) {
    const player = colorForRole(move.role, startingRole)
    const { row, col } = indexToCell(move.index)
    const flips = flipsForMove(board, row, col, player)
    board = applyMove(board, row, col, player, flips)
    lastPlayer = player
  }

  if (lastPlayer === null) {
    return { board, player: BLACK, over: false }
  }

  const turn = nextTurn(board, lastPlayer)
  return { board, player: turn.player, over: turn.over }
}

// Positional weights for the AI. Corners can never be flipped once taken,
// so they're worth far more than the discs they turn over; the squares
// beside a corner are penalised because playing one usually hands the
// corner to the opponent. Edges are mildly good, the interior neutral.
const WEIGHTS = [
  [120, -20, 20, 5, 5, 20, -20, 120],
  [-20, -40, -5, -5, -5, -5, -40, -20],
  [20, -5, 15, 3, 3, 15, -5, 20],
  [5, -5, 3, 3, 3, 3, -5, 5],
  [5, -5, 3, 3, 3, 3, -5, 5],
  [20, -5, 15, 3, 3, 15, -5, 20],
  [-20, -40, -5, -5, -5, -5, -40, -20],
  [120, -20, 20, 5, 5, 20, -20, 120],
]

// One ply deep: square value plus how many discs it flips. Deliberately
// simple - a greedy "most flips" bot is a pushover because grabbing discs
// early is actively bad in Othello, and the weight table fixes most of that
// without the machinery of a minimax search.
export function chooseAiMove(board, player) {
  const moves = legalMoves(board, player)
  if (moves.length === 0) return null

  let best = moves[0]
  let bestScore = -Infinity
  for (const move of moves) {
    const score = WEIGHTS[move.row][move.col] + move.flips.length
    if (score > bestScore) {
      bestScore = score
      best = move
    }
  }
  return best
}
