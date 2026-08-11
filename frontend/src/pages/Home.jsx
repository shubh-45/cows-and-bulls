import { Link } from 'react-router-dom'
import { GAMES } from '../data/gamesCatalog'
import './Home.css'

export default function Home() {
  return (
    <div className="page home">
      <header className="hub-header">
        <p className="eyebrow">The Arcade</p>
        <h1>Pick a game</h1>
        <p className="subtitle">A small, growing collection of logic and reflex games.</p>
      </header>

      <div className="game-grid">
        {GAMES.map((game) => (
          <GameCard key={game.id} game={game} />
        ))}
      </div>
    </div>
  )
}

function GameCard({ game }) {
  const isLive = game.status === 'live'
  // CSS custom property set inline so each card can use its own accent
  // color without needing a separate CSS class per game.
  const style = { '--card-accent': game.accent }

  const content = (
    <>
      <span className="card-icon" style={style}>{game.icon}</span>
      <h2>{game.title}</h2>
      <p>{game.tagline}</p>
      {!isLive && <span className="badge-soon">Coming soon</span>}
    </>
  )

  if (isLive) {
    return (
      <Link to={game.path} className="game-card" style={style}>
        {content}
      </Link>
    )
  }

  return (
    <div className="game-card game-card-disabled" style={style} aria-disabled="true">
      {content}
    </div>
  )
}
