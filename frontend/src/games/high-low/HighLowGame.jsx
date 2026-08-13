import { useState } from 'react'
import { Link } from 'react-router-dom'
import StatsLine from '../../components/StatsLine'
import { useGameResult } from '../../lib/useGameResult'
import './HighLow.css'

const MIN = 1
const MAX = 100

// Binary search finds any number in this range in at most 7 guesses -
// tiers are calibrated around that.
function tierFor(attempts) {
  if (attempts <= 5) return { label: 'Gold - Sharp Shooter', emoji: '🥇', className: 'tier-gold' }
  if (attempts <= 8) return { label: 'Silver - Solid Guessing', emoji: '🥈', className: 'tier-silver' }
  if (attempts <= 12) return { label: 'Bronze - Got There', emoji: '🥉', className: 'tier-bronze' }
  return { label: 'Solved - Keep Practicing', emoji: '🎯', className: 'tier-participant' }
}

function randomSecret() {
  return Math.floor(Math.random() * (MAX - MIN + 1)) + MIN
}

export default function HighLowGame() {
  const [secret, setSecret] = useState(randomSecret)
  const [guessValue, setGuessValue] = useState('')
  const [history, setHistory] = useState([])
  const [won, setWon] = useState(false)
  const [error, setError] = useState('')

  function startNewGame() {
    setSecret(randomSecret())
    setHistory([])
    setWon(false)
    setGuessValue('')
    setError('')
  }

  function handleSubmit(e) {
    e.preventDefault()
    const guess = Number(guessValue)

    if (!Number.isInteger(guess) || guess < MIN || guess > MAX) {
      setError(`Enter a whole number between ${MIN} and ${MAX}`)
      return
    }
    setError('')

    const direction = guess === secret ? 'correct' : guess < secret ? 'higher' : 'lower'
    setHistory((prev) => [{ attempt: prev.length + 1, guess, direction }, ...prev])
    setGuessValue('')

    if (direction === 'correct') {
      setWon(true)
    }
  }

  useGameResult('high-low', { ended: won, won: true, score: history.length, lowerIsBetter: true })

  const tier = won ? tierFor(history.length) : null

  return (
    <div className="page theme-highlow">
      <Link to="/" className="back-link">← All games</Link>
      <header className="page-header">
        <p className="eyebrow">Deduction</p>
        <h1>Higher or Lower</h1>
        <p className="subtitle">The system picked a number 1-100. Find it in as few guesses as possible.</p>
      </header>

      <main className="game-panel">
        {won ? (
          <div className={`reward-banner ${tier.className}`}>
            <div className="reward-emoji">{tier.emoji}</div>
            <h2>Found it in {history.length} guess{history.length !== 1 ? 'es' : ''}!</h2>
            <p className="reward-tier-label">{tier.label}</p>
            <p className="reward-secret">The number was <strong>{secret}</strong></p>
            <StatsLine gameId="high-low" formatBest={(n) => `${n} guess${n === 1 ? '' : 'es'}`} />
            <button className="btn btn-primary" onClick={startNewGame}>Play Again</button>
          </div>
        ) : (
          <form className="highlow-form" onSubmit={handleSubmit}>
            <input
              className="highlow-input"
              type="number"
              min={MIN}
              max={MAX}
              inputMode="numeric"
              placeholder="50"
              value={guessValue}
              onChange={(e) => setGuessValue(e.target.value)}
              aria-label={`Enter a number between ${MIN} and ${MAX}`}
            />
            <button className="btn btn-primary" type="submit">Guess</button>
            {error && <p className="field-error">{error}</p>}
          </form>
        )}

        {history.length > 0 && (
          <section className="history-section">
            <h2>Guess Log</h2>
            <ol className="highlow-history">
              {history.map((h) => (
                <li key={h.attempt} className={`highlow-row direction-${h.direction}`}>
                  <span className="attempt-number">#{h.attempt}</span>
                  <span className="highlow-guess">{h.guess}</span>
                  <span className="highlow-direction">
                    {h.direction === 'correct' && '🎯 Correct'}
                    {h.direction === 'higher' && '↑ Go higher'}
                    {h.direction === 'lower' && '↓ Go lower'}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        )}
      </main>
    </div>
  )
}
