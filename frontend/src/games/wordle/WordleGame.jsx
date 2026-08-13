import { useEffect, useReducer, useState } from 'react'
import { Link } from 'react-router-dom'
import { isValidGuess, randomWord } from './words'
import StatsLine from '../../components/StatsLine'
import { useGameResult } from '../../lib/useGameResult'
import './Wordle.css'

const WORD_LENGTH = 5
const MAX_GUESSES = 6

const KEY_ROWS = [
  ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
  ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
  ['ENTER', 'Z', 'X', 'C', 'V', 'B', 'N', 'M', 'BACK'],
]

// Two passes, and the order matters. Pass 1 claims every exact-position
// match and tallies the answer's *remaining* letters. Pass 2 then hands out
// "present" only while an unclaimed copy of that letter is still available.
// Doing it in one pass is the classic duplicate-letter bug: guessing SPEED
// against SPEND would light up the second E as present even though the only
// E in the answer is already spoken for by the first one.
export function scoreGuess(guess, answer) {
  const result = Array(WORD_LENGTH).fill('absent')
  const remaining = {}

  for (let i = 0; i < WORD_LENGTH; i++) {
    if (guess[i] === answer[i]) {
      result[i] = 'correct'
    } else {
      remaining[answer[i]] = (remaining[answer[i]] || 0) + 1
    }
  }

  for (let i = 0; i < WORD_LENGTH; i++) {
    if (result[i] === 'correct') continue
    const letter = guess[i]
    if (remaining[letter] > 0) {
      result[i] = 'present'
      remaining[letter] -= 1
    }
  }

  return result
}

// A key on the on-screen keyboard shows the best news that letter has ever
// earned, so a letter confirmed green never drops back to yellow later.
const RANK = { absent: 1, present: 2, correct: 3 }

function buildKeyStates(guesses) {
  const states = {}
  for (const { word, score } of guesses) {
    for (let i = 0; i < WORD_LENGTH; i++) {
      const letter = word[i]
      const next = score[i]
      if (!states[letter] || RANK[next] > RANK[states[letter]]) {
        states[letter] = next
      }
    }
  }
  return states
}

function tierFor(attempts) {
  if (attempts <= 2) return { label: 'Gold - Uncanny', emoji: '🥇', className: 'tier-gold' }
  if (attempts <= 4) return { label: 'Silver - Sharp Deduction', emoji: '🥈', className: 'tier-silver' }
  if (attempts <= 5) return { label: 'Bronze - Got There', emoji: '🥉', className: 'tier-bronze' }
  return { label: 'Solved - Down to the Wire', emoji: '🎯', className: 'tier-participant' }
}

function init(answer) {
  return { answer, guesses: [], current: '', status: 'playing', message: '', shake: 0 }
}

// All input rules live in this reducer rather than in the event handler.
// A handler would have to close over `current`, and that closure goes stale
// between renders - fast typing (or any burst of key events dispatched
// before React re-renders) would submit an empty guess. A reducer always
// sees the latest state, so the typed word and the Enter that submits it
// can never disagree.
//
// Kept pure for StrictMode's double-invocation: the new word for a fresh
// round is chosen by the caller and passed in, not rolled in here.
function reducer(state, action) {
  switch (action.type) {
    case 'restart':
      return init(action.answer)

    case 'key': {
      if (state.status !== 'playing') return state
      const key = action.key

      if (key === 'BACK') {
        return { ...state, current: state.current.slice(0, -1), message: '' }
      }

      // Wiping a rejected word one backspace at a time is tedious, so the
      // whole row can go in one action.
      if (key === 'CLEAR') {
        return { ...state, current: '', message: '' }
      }

      if (key === 'ENTER') {
        if (state.current.length !== WORD_LENGTH) {
          return { ...state, message: `Needs ${WORD_LENGTH} letters`, shake: state.shake + 1 }
        }
        if (!isValidGuess(state.current)) {
          return { ...state, message: `"${state.current}" isn't a word I know`, shake: state.shake + 1 }
        }

        const score = scoreGuess(state.current, state.answer)
        const guesses = [...state.guesses, { word: state.current, score }]
        const won = state.current === state.answer
        const status = won ? 'won' : guesses.length === MAX_GUESSES ? 'lost' : 'playing'

        return { ...state, guesses, current: '', message: '', status }
      }

      if (/^[A-Z]$/.test(key)) {
        if (state.current.length >= WORD_LENGTH) return state
        return { ...state, current: state.current + key, message: '' }
      }

      return state
    }

    default:
      return state
  }
}

export default function WordleGame() {
  const [state, dispatch] = useReducer(reducer, undefined, () => init(randomWord()))
  const { answer, guesses, current, status, message, shake } = state
  const [shaking, setShaking] = useState(false)

  function handleKey(key) {
    dispatch({ type: 'key', key: key.toUpperCase() })
  }

  function startNewGame() {
    dispatch({ type: 'restart', answer: randomWord() })
  }

  // Physical keyboard support. The on-screen keys dispatch the same action,
  // so there is exactly one place where input rules live.
  useEffect(() => {
    function onKeyDown(e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'Enter') dispatch({ type: 'key', key: 'ENTER' })
      else if (e.key === 'Backspace') dispatch({ type: 'key', key: 'BACK' })
      else if (/^[a-zA-Z]$/.test(e.key)) dispatch({ type: 'key', key: e.key.toUpperCase() })
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // `shake` is a counter, not a boolean, so two rejected guesses in a row
  // still replay the animation the second time.
  useEffect(() => {
    if (!shake) return undefined
    setShaking(true)
    const timer = setTimeout(() => setShaking(false), 400)
    return () => clearTimeout(timer)
  }, [shake])

  // Fewer guesses is better, so the personal best is a minimum.
  useGameResult('wordle', {
    ended: status !== 'playing',
    won: status === 'won',
    score: guesses.length,
    lowerIsBetter: true,
  })

  const keyStates = buildKeyStates(guesses)
  const tier = status === 'won' ? tierFor(guesses.length) : null

  // Build all six rows up front: submitted rows, the row being typed, then
  // empty rows - so the board never changes height as the game goes on.
  const rows = []
  for (let r = 0; r < MAX_GUESSES; r++) {
    if (r < guesses.length) {
      rows.push({ key: r, letters: guesses[r].word.split(''), score: guesses[r].score, submitted: true })
    } else if (r === guesses.length && status === 'playing') {
      rows.push({ key: r, letters: current.padEnd(WORD_LENGTH, ' ').split(''), score: null, submitted: false })
    } else {
      rows.push({ key: r, letters: Array(WORD_LENGTH).fill(' '), score: null, submitted: false })
    }
  }

  return (
    <div className="page theme-wordle">
      <Link to="/" className="back-link">← All games</Link>
      <header className="page-header">
        <p className="eyebrow">Word Puzzle</p>
        <h1>Wordle Clone</h1>
        <p className="subtitle">Five letters, six guesses. Green is right spot, yellow is wrong spot.</p>
      </header>

      <main className="game-panel">
        {status === 'won' && (
          <div className={`reward-banner ${tier.className}`}>
            <div className="reward-emoji">{tier.emoji}</div>
            <h2>Solved in {guesses.length} guess{guesses.length !== 1 ? 'es' : ''}!</h2>
            <p className="reward-tier-label">{tier.label}</p>
            <p className="reward-secret">The word was <strong>{answer}</strong></p>
            <StatsLine gameId="wordle" formatBest={(n) => `${n} guess${n === 1 ? '' : 'es'}`} />
            <button className="btn btn-primary" onClick={startNewGame}>Play Again</button>
          </div>
        )}

        {status === 'lost' && (
          <div className="reward-banner tier-participant">
            <div className="reward-emoji">😔</div>
            <h2>Out of guesses</h2>
            <p className="reward-secret">The word was <strong>{answer}</strong></p>
            <button className="btn btn-primary" onClick={startNewGame}>Try Another</button>
          </div>
        )}

        {/* aria-live announces a rejected guess to a screen reader. The slot
            keeps its height when empty so the board never jumps. */}
        <div className="wordle-message-row">
          <p className="wordle-message" aria-live="polite">{message}</p>
          {status === 'playing' && current.length > 0 && (
            <button
              type="button"
              className="wordle-clear"
              onClick={() => dispatch({ type: 'key', key: 'CLEAR' })}
            >
              Clear
            </button>
          )}
        </div>

        <div className={`wordle-board ${shaking ? 'is-shaking' : ''}`}>
          {rows.map((row) => (
            <div className="wordle-row" key={row.key}>
              {row.letters.map((letter, i) => {
                const tileState = row.score ? row.score[i] : ''
                const filled = letter !== ' '
                return (
                  <div
                    key={i}
                    className={`wordle-tile ${tileState ? `tile-${tileState}` : ''} ${
                      filled && !row.submitted ? 'is-filled' : ''
                    }`}
                    // stagger the reveal left-to-right across the row
                    style={row.submitted ? { animationDelay: `${i * 90}ms` } : undefined}
                  >
                    {filled ? letter : ''}
                  </div>
                )
              })}
            </div>
          ))}
        </div>

        {status === 'playing' && (
          <div className="wordle-keyboard">
            {KEY_ROWS.map((keyRow, rowIndex) => (
              <div className="keyboard-row" key={rowIndex}>
                {keyRow.map((key) => {
                  const wide = key === 'ENTER' || key === 'BACK'
                  return (
                    <button
                      key={key}
                      type="button"
                      className={`key ${wide ? 'key-wide' : ''} ${
                        keyStates[key] ? `key-${keyStates[key]}` : ''
                      }`}
                      onClick={() => handleKey(key)}
                      aria-label={key === 'BACK' ? 'Backspace' : key}
                    >
                      {key === 'BACK' ? '⌫' : key}
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
        )}

        <details className="wordle-rules">
          <summary>How to play</summary>
          <div className="rules-body">
            <p>
              Guess the five-letter word in six tries. Type with your keyboard or
              tap the keys above, then press <strong>Enter</strong> to submit.
              After each guess the tiles change color to show how close you were.
            </p>

            <ul className="rules-legend">
              <li>
                <span className="wordle-tile tile-correct legend-tile">W</span>
                <span><strong>Green</strong> &mdash; right letter, right spot.</span>
              </li>
              <li>
                <span className="wordle-tile tile-present legend-tile">O</span>
                <span><strong>Yellow</strong> &mdash; the word has this letter, but somewhere else.</span>
              </li>
              <li>
                <span className="wordle-tile tile-absent legend-tile">X</span>
                <span><strong>Grey</strong> &mdash; this letter isn't in the word at all.</span>
              </li>
            </ul>

            <p>
              Repeated letters are counted, not just matched. If the answer holds
              only one <strong>E</strong> and you guess two, just one of them
              lights up &mdash; the second stays grey.
            </p>
            <p>
              Guesses have to be real words. The on-screen keyboard keeps score as
              you go, so a letter you've already ruled out stays greyed out.
            </p>
          </div>
        </details>
      </main>
    </div>
  )
}
