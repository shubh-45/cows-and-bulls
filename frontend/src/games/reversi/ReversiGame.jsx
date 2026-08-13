import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  BLACK,
  WHITE,
  EMPTY,
  applyMove,
  chooseAiMove,
  countDiscs,
  createBoard,
  flipsForMove,
  legalMoves,
  nextTurn,
} from './logic'
import ReversiOnline from './ReversiOnline'
import Celebration from '../../components/Celebration'
import StatsLine from '../../components/StatsLine'
import { useGameResult } from '../../lib/useGameResult'
import './Reversi.css'

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']

// The human always plays Black, which also moves first.
const HUMAN = BLACK
const AI = WHITE

function squareName(row, col) {
  return `${FILES[col]}${row + 1}`
}

export default function ReversiGame() {
  const [board, setBoard] = useState(createBoard)
  const [player, setPlayer] = useState(BLACK)
  const [status, setStatus] = useState('playing') // playing | over
  const [message, setMessage] = useState('')
  const [vsComputer, setVsComputer] = useState(true)
  const [lastMove, setLastMove] = useState(null)
  const [online, setOnline] = useState(false)

  const moves = status === 'playing' ? legalMoves(board, player) : []
  const legalSet = new Set(moves.map((m) => `${m.row},${m.col}`))
  const { black, white } = countDiscs(board)

  function startNewGame(nextVsComputer = vsComputer) {
    setBoard(createBoard())
    setPlayer(BLACK)
    setStatus('playing')
    setMessage('')
    setLastMove(null)
    setVsComputer(nextVsComputer)
  }

  // Shared by human clicks and the AI so passing and game-over are decided
  // in exactly one place.
  function commitMove(currentBoard, move, mover) {
    const nextBoard = applyMove(currentBoard, move.row, move.col, mover, move.flips)
    const turn = nextTurn(nextBoard, mover)

    setBoard(nextBoard)
    setLastMove({ row: move.row, col: move.col })
    setPlayer(turn.player)

    if (turn.over) {
      setStatus('over')
      setMessage('')
    } else if (turn.passed) {
      const skipped = turn.player === BLACK ? 'White' : 'Black'
      setMessage(`${skipped} has no legal move and passes.`)
    } else {
      setMessage('')
    }
  }

  function handleCellClick(row, col) {
    if (status !== 'playing') return
    if (vsComputer && player !== HUMAN) return

    const flips = flipsForMove(board, row, col, player)
    if (flips.length === 0) return

    commitMove(board, { row, col, flips }, player)
  }

  // The AI's turn runs from an effect rather than inline in the click
  // handler, so a pass that hands White two moves in a row still triggers
  // a second AI move. The delay just makes the reply readable.
  useEffect(() => {
    if (!vsComputer || status !== 'playing' || player !== AI) return undefined

    const timer = setTimeout(() => {
      const move = chooseAiMove(board, AI)
      if (move) commitMove(board, move, AI)
    }, 550)

    return () => clearTimeout(timer)
  }, [board, player, status, vsComputer])

  const gameOver = status === 'over'
  const winner = black > white ? 'black' : white > black ? 'white' : 'draw'

  // Only vs-computer games count towards personal stats: in hot-seat mode
  // two people share the device, so "you won" has no single meaning. Final
  // disc count is the score, and more is better.
  useGameResult('reversi', {
    ended: gameOver && vsComputer && !online,
    won: winner === 'black',
    score: black,
    lowerIsBetter: false,
  })

  let resultTier = 'tier-participant'
  let resultEmoji = '🤝'
  let resultTitle = "It's a draw"
  if (winner === 'black') {
    resultTier = 'tier-gold'
    resultEmoji = '🥇'
    resultTitle = vsComputer ? 'You win!' : 'Black wins!'
  } else if (winner === 'white') {
    resultTier = 'tier-silver'
    resultEmoji = '🥈'
    resultTitle = vsComputer ? 'Computer wins' : 'White wins!'
  }

  const turnLabel = player === BLACK ? 'Black' : 'White'
  const youLabel = vsComputer && player === HUMAN ? ' (you)' : ''

  return (
    <div className="page theme-reversi">
      <Link to="/" className="back-link">← All games</Link>
      <header className="page-header">
        <p className="eyebrow">Strategy</p>
        <h1>Reversi</h1>
        <p className="subtitle">Outflank your opponent's discs to flip them. Most discs at the end wins.</p>
      </header>

      <main className="game-panel">
        {online ? (
          <ReversiOnline onExit={() => setOnline(false)} />
        ) : (
        <>
        <div className="reversi-status">
          <span className={`score-chip ${player === BLACK && !gameOver ? 'is-turn' : ''}`}>
            <span className="disc disc-black disc-chip" aria-hidden="true" />
            <strong>{black}</strong> Black
          </span>
          <span className={`score-chip ${player === WHITE && !gameOver ? 'is-turn' : ''}`}>
            <span className="disc disc-white disc-chip" aria-hidden="true" />
            <strong>{white}</strong> White
          </span>
          <button className="btn btn-ghost" onClick={() => startNewGame()}>New Game</button>
        </div>

        {gameOver ? (
          <>
          <Celebration outcome={winner === 'black' ? 'win' : winner === 'white' ? 'lose' : 'draw'} />
          <div className={`reward-banner ${resultTier}`}>
            <div className="reward-emoji">{resultEmoji}</div>
            <h2>{resultTitle}</h2>
            <p className="reward-secret">Final score {black} &ndash; {white}</p>
            {vsComputer && <StatsLine gameId="reversi" formatBest={(n) => `${n} discs`} />}
            <button className="btn btn-primary" onClick={() => startNewGame()}>Play Again</button>
          </div>
          </>
        ) : (
          <p className="reversi-turn" aria-live="polite">
            {message && <span className="reversi-pass">{message} </span>}
            <span className="disc-inline" aria-hidden="true">
              <span className={`disc ${player === BLACK ? 'disc-black' : 'disc-white'} disc-chip`} />
            </span>
            {turnLabel}{youLabel} to move &middot; {moves.length} legal move{moves.length !== 1 ? 's' : ''}
          </p>
        )}

        <div className="reversi-board" role="grid" aria-label="Reversi board">
          {board.map((rowCells, row) =>
            rowCells.map((cell, col) => {
              const isLegal = legalSet.has(`${row},${col}`)
              const isLast = lastMove && lastMove.row === row && lastMove.col === col
              const playable = isLegal && (!vsComputer || player === HUMAN)
              return (
                <button
                  key={`${row}-${col}`}
                  type="button"
                  role="gridcell"
                  className={`reversi-cell ${playable ? 'is-legal' : ''} ${isLast ? 'is-last' : ''}`}
                  onClick={() => handleCellClick(row, col)}
                  disabled={!playable}
                  aria-label={
                    cell === BLACK
                      ? `${squareName(row, col)}, black disc`
                      : cell === WHITE
                      ? `${squareName(row, col)}, white disc`
                      : playable
                      ? `Play ${squareName(row, col)}`
                      : `${squareName(row, col)}, empty`
                  }
                >
                  {cell !== EMPTY && (
                    <span className={`disc ${cell === BLACK ? 'disc-black' : 'disc-white'}`} />
                  )}
                </button>
              )
            })
          )}
        </div>

        <div className="reversi-modes">
          <button
            className={`mode-btn ${vsComputer ? 'is-active' : ''}`}
            onClick={() => startNewGame(true)}
          >
            vs Computer
          </button>
          <button
            className={`mode-btn ${!vsComputer ? 'is-active' : ''}`}
            onClick={() => startNewGame(false)}
          >
            2 Players
          </button>
          <button className="mode-btn" onClick={() => setOnline(true)}>
            Online
          </button>
        </div>
        </>
        )}

        <details className="reversi-rules">
          <summary>How to play</summary>
          <div className="rules-body">
            <p>
              Black moves first. A move is only legal if it <strong>outflanks</strong> at
              least one of your opponent's discs: in a straight line from the square you
              play &mdash; across, down or diagonally &mdash; there must be an unbroken run
              of their discs ending in one of yours, with no gaps.
            </p>
            <p>
              Every disc you outflank flips to your color, in all directions at once. If
              you have no legal move your turn is skipped. The game ends when neither side
              can move, and whoever has more discs on the board wins.
            </p>
          </div>
        </details>
      </main>
    </div>
  )
}
