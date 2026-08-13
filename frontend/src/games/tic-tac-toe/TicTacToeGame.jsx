import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Celebration from '../../components/Celebration'
import StatsLine from '../../components/StatsLine'
import { useGameResult } from '../../lib/useGameResult'
import Board, { Badge } from './Board'
import TicTacToeOnline from './TicTacToeOnline'
import {
  O,
  X,
  applyMove,
  chooseAiMove,
  createBoard,
  isFull,
  opponent,
  winnerOf,
} from './logic'
import './TicTacToe.css'

// The human is always X and moves first.
const HUMAN = X
const AI = O

const DIFFICULTIES = [
  { id: 'easy', label: 'Easy' },
  { id: 'medium', label: 'Medium' },
  { id: 'hard', label: 'Perfect' },
]

export default function TicTacToeGame() {
  const [board, setBoard] = useState(createBoard)
  const [player, setPlayer] = useState(X)
  const [lastMove, setLastMove] = useState(null)
  const [vsComputer, setVsComputer] = useState(true)
  // Medium by default: Tic-Tac-Toe is solved, so a perfect opponent turns
  // every game into a draw. "Perfect" is offered, but as a challenge rather
  // than the everyday experience.
  const [difficulty, setDifficulty] = useState('medium')
  const [online, setOnline] = useState(false)

  const winner = winnerOf(board)
  const drawn = !winner && isFull(board)
  const gameOver = Boolean(winner) || drawn

  function startNewGame() {
    setBoard(createBoard())
    setPlayer(X)
    setLastMove(null)
  }

  function play(index) {
    setBoard((current) => applyMove(current, index, player))
    setLastMove(index)
    setPlayer((current) => opponent(current))
  }

  // The AI moves from an effect rather than inside the click handler, so its
  // reply is driven by the board actually having changed - which also means a
  // restart mid-thought cancels cleanly via the cleanup below.
  useEffect(() => {
    if (!vsComputer || online || gameOver || player !== AI) return undefined

    const timer = setTimeout(() => {
      const move = chooseAiMove(board, AI, difficulty)
      if (move !== null) {
        setBoard((current) => applyMove(current, move, AI))
        setLastMove(move)
        setPlayer(HUMAN)
      }
    }, 420)

    return () => clearTimeout(timer)
  }, [board, player, vsComputer, online, gameOver, difficulty])

  // Only vs-computer games count towards personal stats: in hot-seat mode two
  // people share one device, so "you won" has no single meaning. Score is the
  // number of marks you placed, and fewer is a faster win.
  const myMarks = board.filter((cell) => cell === HUMAN).length
  useGameResult('tic-tac-toe', {
    ended: gameOver && vsComputer && !online,
    won: winner?.player === HUMAN,
    score: winner?.player === HUMAN ? myMarks : null,
    lowerIsBetter: true,
  })

  let result = null
  if (gameOver) {
    if (drawn) {
      result = { outcome: 'draw', emoji: '🤝', title: "It's a draw", tier: 'tier-participant' }
    } else if (!vsComputer) {
      result = {
        outcome: 'win',
        emoji: '🏆',
        title: `${winner.player === X ? 'X' : 'O'} wins!`,
        tier: 'tier-gold',
      }
    } else if (winner.player === HUMAN) {
      result = { outcome: 'win', emoji: '🏆', title: 'You win!', tier: 'tier-gold' }
    } else {
      result = { outcome: 'lose', emoji: '🫡', title: 'Computer wins', tier: 'tier-silver' }
    }
  }

  const canPlay = () => !gameOver && (!vsComputer || player === HUMAN)

  return (
    <div className="page theme-tic-tac-toe">
      <Link to="/" className="back-link">← All games</Link>
      <header className="page-header">
        <p className="eyebrow">Classic</p>
        <h1>Tic-Tac-Toe</h1>
        <p className="subtitle">Three in a row wins. Play the computer, a friend beside you, or a friend anywhere.</p>
      </header>

      <main className="game-panel">
        {online ? (
          <TicTacToeOnline onExit={() => setOnline(false)} />
        ) : (
          <>
            <div className="ttt-status">
              {gameOver ? (
                <span className="ttt-turn">Game over</span>
              ) : (
                <span className={`ttt-turn ${player === X ? 'is-x' : 'is-o'}`}>
                  <Badge player={player} />
                  <strong>{player === X ? 'X' : 'O'}</strong>
                  {vsComputer ? (player === HUMAN ? ' - your move' : ' - thinking…') : ' to move'}
                </span>
              )}
              <button className="btn btn-ghost" onClick={startNewGame}>New Game</button>
            </div>

            {result && (
              <>
                <Celebration outcome={result.outcome} />
                <div className={`reward-banner ${result.tier}`}>
                  <div className="reward-emoji">{result.emoji}</div>
                  <h2>{result.title}</h2>
                  {vsComputer && (
                    <p className="reward-tier-label">
                      {DIFFICULTIES.find((d) => d.id === difficulty).label} difficulty
                    </p>
                  )}
                  {vsComputer && <StatsLine gameId="tic-tac-toe" formatBest={(n) => `${n} marks`} />}
                  <button className="btn btn-primary" onClick={startNewGame}>Play Again</button>
                </div>
              </>
            )}

            <Board
              board={board}
              winner={winner}
              onPlay={play}
              canPlay={canPlay}
              lastMove={lastMove}
            />

            {vsComputer && (
              <div className="ttt-difficulty">
                <span className="ttt-difficulty-label">Difficulty</span>
                {DIFFICULTIES.map((option) => (
                  <button
                    key={option.id}
                    className={`mode-btn ${difficulty === option.id ? 'is-active' : ''}`}
                    onClick={() => {
                      setDifficulty(option.id)
                      startNewGame()
                    }}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            )}

            <div className="ttt-modes">
              <button
                className={`mode-btn ${vsComputer ? 'is-active' : ''}`}
                onClick={() => { setVsComputer(true); startNewGame() }}
              >
                vs Computer
              </button>
              <button
                className={`mode-btn ${!vsComputer ? 'is-active' : ''}`}
                onClick={() => { setVsComputer(false); startNewGame() }}
              >
                2 Players
              </button>
              <button className="mode-btn" onClick={() => setOnline(true)}>
                Online
              </button>
            </div>
          </>
        )}

        <details className="ttt-rules">
          <summary>How to play</summary>
          <div className="rules-body">
            <p>
              X always goes first. Take turns claiming squares; the first player
              to get three of their own marks in a row &mdash; across, down or
              diagonally &mdash; wins. If all nine squares fill with no line, the
              game is a draw.
            </p>
            <p>
              Tic-Tac-Toe is a <strong>solved game</strong>: two players who never
              make a mistake will always draw. That is why <strong>Perfect</strong>
              difficulty cannot be beaten &mdash; a draw against it is the best
              result there is. Easy and Medium make mistakes, so a win is on.
            </p>
          </div>
        </details>
      </main>
    </div>
  )
}
