import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { startNewGame, submitGuess } from './api/gameApi'
import GuessForm from './components/GuessForm'
import GuessHistory from './components/GuessHistory'
import RewardBadge from './components/RewardBadge'
import RulesPanel from './components/RulesPanel'
import CowsAndBullsOnline from './CowsAndBullsOnline'
import StatsLine from '../../components/StatsLine'
import { useGameResult } from '../../lib/useGameResult'
import './CowsAndBulls.css'

// "status" is a simple state machine for the whole screen:
// loading -> playing -> won   (or -> error, if the API call fails)
export default function CowsAndBullsGame() {
  const [gameId, setGameId] = useState(null)
  const [history, setHistory] = useState([])
  const [lastResult, setLastResult] = useState(null)
  const [status, setStatus] = useState('loading')
  const [errorMessage, setErrorMessage] = useState('')
  // Online is a whole different screen rather than a variant of this one: it
  // has a room, turns and an opponent, and none of the solo state applies.
  const [online, setOnline] = useState(false)

  async function beginNewGame() {
    setStatus('loading')
    setErrorMessage('')
    setHistory([])
    setLastResult(null)
    try {
      const data = await startNewGame()
      setGameId(data.gameId)
      setStatus('playing')
    } catch (err) {
      setErrorMessage(err.message)
      setStatus('error')
    }
  }

  // useEffect with an empty dependency array ([]) runs once, right after the
  // component first renders - the standard way to do "on page load" work
  // like fetching initial data.
  useEffect(() => {
    beginNewGame()
  }, [])

  async function handleGuess(guess) {
    try {
      const result = await submitGuess(gameId, guess)
      setHistory(result.history)
      setLastResult(result)
      if (result.won) {
        setStatus('won')
      }
    } catch (err) {
      setErrorMessage(err.message)
    }
  }

  // The backend is authoritative here - it holds the secret and counts the
  // attempts - so this is the one game whose score the client cannot inflate.
  useGameResult('cows-and-bulls', {
    ended: status === 'won',
    won: true,
    score: history.length,
    lowerIsBetter: true,
  })

  return (
    <div className="page theme-cows-bulls">
      <Link to="/" className="back-link">← All games</Link>
      <header className="page-header">
        <p className="eyebrow">Code-breaking</p>
        <h1>Cows &amp; Bulls</h1>
        <p className="subtitle">Crack the 3-digit code. Alone, or racing a friend turn by turn.</p>
      </header>

      <main className="game-panel">
        {online ? (
          <CowsAndBullsOnline onExit={() => setOnline(false)} />
        ) : (
          <>
        {status === 'loading' && <p className="empty-state">Starting a new game…</p>}

        {status === 'error' && (
          <div className="error-banner">
            <p>{errorMessage}</p>
            <button className="btn btn-primary" onClick={beginNewGame}>Try again</button>
          </div>
        )}

        {(status === 'playing' || status === 'won') && (
          <>
            {errorMessage && <p className="field-error">{errorMessage}</p>}

            {status === 'playing' && (
              <GuessForm onSubmit={handleGuess} disabled={status !== 'playing'} />
            )}

            {status === 'won' && lastResult && (
              <RewardBadge result={lastResult} onPlayAgain={beginNewGame} />
            )}

            <RulesPanel />

            <section className="history-section">
              <h2>Guess Log</h2>
              <GuessHistory history={history} />
            </section>
          </>
        )}

        <div className="cb-modes">
          <button className="mode-btn" onClick={() => setOnline(true)}>
            Play a friend online
          </button>
        </div>
          </>
        )}
      </main>
    </div>
  )
}
