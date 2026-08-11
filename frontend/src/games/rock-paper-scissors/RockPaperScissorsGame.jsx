import { useState } from 'react'
import { Link } from 'react-router-dom'
import './RockPaperScissors.css'

const CHOICES = [
  { id: 'rock', emoji: '✊', label: 'Rock' },
  { id: 'paper', emoji: '✋', label: 'Paper' },
  { id: 'scissors', emoji: '✌️', label: 'Scissors' },
]

// What beats what. rock -> beats -> scissors, etc.
const BEATS = { rock: 'scissors', paper: 'rock', scissors: 'paper' }

function judge(player, computer) {
  if (player === computer) return 'tie'
  return BEATS[player] === computer ? 'win' : 'lose'
}

const RESULT_TEXT = {
  win: 'You win this round',
  lose: 'Machine wins this round',
  tie: "It's a tie",
}

export default function RockPaperScissorsGame() {
  const [playerChoice, setPlayerChoice] = useState(null)
  const [computerChoice, setComputerChoice] = useState(null)
  const [result, setResult] = useState(null)
  const [score, setScore] = useState({ win: 0, lose: 0, tie: 0 })
  const [rounds, setRounds] = useState(0)

  function play(choiceId) {
    const computer = CHOICES[Math.floor(Math.random() * CHOICES.length)].id
    const outcome = judge(choiceId, computer)

    setPlayerChoice(choiceId)
    setComputerChoice(computer)
    setResult(outcome)
    setScore((prev) => ({ ...prev, [outcome]: prev[outcome] + 1 }))
    setRounds((prev) => prev + 1)
  }

  function resetMatch() {
    setPlayerChoice(null)
    setComputerChoice(null)
    setResult(null)
    setScore({ win: 0, lose: 0, tie: 0 })
    setRounds(0)
  }

  const emojiFor = (id) => CHOICES.find((c) => c.id === id)?.emoji

  return (
    <div className="page theme-rps">
      <Link to="/" className="back-link">← All games</Link>
      <header className="page-header">
        <p className="eyebrow">Reflex</p>
        <h1>Rock · Paper · Scissors</h1>
        <p className="subtitle">Best the machine over as many rounds as you like.</p>
      </header>

      <main className="game-panel">
        <div className="scoreboard">
          <Stat label="Wins" value={score.win} />
          <Stat label="Losses" value={score.lose} />
          <Stat label="Ties" value={score.tie} />
        </div>

        {result && (
          <div className={`round-result result-${result}`}>
            <div className="vs-row">
              <span className="vs-emoji">{emojiFor(playerChoice)}</span>
              <span className="vs-label">vs</span>
              <span className="vs-emoji">{emojiFor(computerChoice)}</span>
            </div>
            <p>{RESULT_TEXT[result]}</p>
          </div>
        )}

        <div className="choice-row">
          {CHOICES.map((choice) => (
            <button
              key={choice.id}
              className="choice-btn"
              onClick={() => play(choice.id)}
              aria-label={choice.label}
            >
              <span className="choice-emoji">{choice.emoji}</span>
              {choice.label}
            </button>
          ))}
        </div>

        {rounds > 0 && (
          <button className="btn btn-ghost reset-btn" onClick={resetMatch}>
            Reset match ({rounds} round{rounds !== 1 ? 's' : ''} played)
          </button>
        )}
      </main>
    </div>
  )
}

function Stat({ label, value }) {
  return (
    <div className="stat">
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  )
}
