import { useState } from 'react'
import { Link } from 'react-router-dom'
import './MemoryMatch.css'

// 8 symbols x 2 copies each = 16 cards, laid out on a 4x4 grid.
const SYMBOLS = ['🎮', '🕹️', '🎲', '🃏', '🏆', '⭐', '🔥', '🎧']

function shuffledDeck() {
  const pairs = [...SYMBOLS, ...SYMBOLS]
  // Fisher-Yates shuffle
  for (let i = pairs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[pairs[i], pairs[j]] = [pairs[j], pairs[i]]
  }
  return pairs.map((symbol, index) => ({ id: index, symbol, matched: false }))
}

function tierFor(moves) {
  if (moves <= 10) return { label: 'Gold - Sharp Memory', emoji: '🥇', className: 'tier-gold' }
  if (moves <= 14) return { label: 'Silver - Solid Recall', emoji: '🥈', className: 'tier-silver' }
  if (moves <= 20) return { label: 'Bronze - Got There', emoji: '🥉', className: 'tier-bronze' }
  return { label: 'Solved - Keep Practicing', emoji: '🎯', className: 'tier-participant' }
}

export default function MemoryMatchGame() {
  const [cards, setCards] = useState(shuffledDeck)
  const [flipped, setFlipped] = useState([]) // indices currently face-up, not yet matched
  const [moves, setMoves] = useState(0)
  const [locked, setLocked] = useState(false) // true while a mismatched pair is briefly shown

  const matchedCount = cards.filter((c) => c.matched).length
  const won = matchedCount === cards.length

  function startNewGame() {
    setCards(shuffledDeck())
    setFlipped([])
    setMoves(0)
    setLocked(false)
  }

  function handleCardClick(index) {
    if (locked || won) return
    if (flipped.includes(index) || cards[index].matched) return

    const nextFlipped = [...flipped, index]
    setFlipped(nextFlipped)

    if (nextFlipped.length === 2) {
      setMoves((prev) => prev + 1)
      const [firstIndex, secondIndex] = nextFlipped
      const isMatch = cards[firstIndex].symbol === cards[secondIndex].symbol

      if (isMatch) {
        setCards((prev) =>
          prev.map((c, i) => (i === firstIndex || i === secondIndex ? { ...c, matched: true } : c))
        )
        setFlipped([])
      } else {
        // briefly show the mismatched pair, then flip them back
        setLocked(true)
        setTimeout(() => {
          setFlipped([])
          setLocked(false)
        }, 700)
      }
    }
  }

  const tier = won ? tierFor(moves) : null

  return (
    <div className="page theme-memory">
      <Link to="/" className="back-link">← All games</Link>
      <header className="page-header">
        <p className="eyebrow">Cards</p>
        <h1>Memory Match</h1>
        <p className="subtitle">Flip two cards at a time and find every pair.</p>
      </header>

      <main className="game-panel">
        <div className="memory-status">
          <span>Moves: {moves}</span>
          <span>Pairs: {matchedCount} / {SYMBOLS.length}</span>
          <button className="btn btn-ghost" onClick={startNewGame}>New Game</button>
        </div>

        {won && (
          <div className={`reward-banner ${tier.className}`}>
            <div className="reward-emoji">{tier.emoji}</div>
            <h2>Matched all {SYMBOLS.length} pairs in {moves} moves!</h2>
            <p className="reward-tier-label">{tier.label}</p>
            <button className="btn btn-primary" onClick={startNewGame}>Play Again</button>
          </div>
        )}

        <div className="memory-grid">
          {cards.map((card, index) => {
            const isFaceUp = card.matched || flipped.includes(index)
            return (
              <button
                key={card.id}
                className={`memory-card ${isFaceUp ? 'is-flipped' : ''} ${card.matched ? 'is-matched' : ''}`}
                onClick={() => handleCardClick(index)}
                aria-label={isFaceUp ? card.symbol : 'Hidden card'}
                disabled={won}
              >
                <span className="memory-card-inner">
                  <span className="memory-card-face memory-card-front">?</span>
                  <span className="memory-card-face memory-card-back">{card.symbol}</span>
                </span>
              </button>
            )
          })}
        </div>
      </main>
    </div>
  )
}
