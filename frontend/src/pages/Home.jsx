import { Link } from 'react-router-dom'
import { GAMES } from '../data/gamesCatalog'
import './Home.css'

// The hub is the storefront, so it gets more visual energy than the game
// screens do: a gradient hero and cards that lean hard on each game's own
// accent color.
export default function Home() {
  return (
    <div className="page home">
      <section className="hub-hero">
        <p className="hub-eyebrow">The Arcade</p>
        <h1 className="hub-title">Pick a game</h1>
        <p className="hub-tagline">
          A small collection of logic, word and strategy games. No installs, no
          accounts &mdash; just play.
        </p>
        <p className="hub-meta">
          <span><strong>{GAMES.length}</strong> games</span>
          <span className="hub-meta-sep" aria-hidden="true" />
          <span>free forever</span>
        </p>
      </section>

      <div className="game-grid">
        {GAMES.map((game) => (
          <GameCard key={game.id} game={game} />
        ))}
      </div>
    </div>
  )
}

function GameCard({ game }) {
  // CSS custom property set inline so each card can drive its own accent -
  // icon chip, glow, border and CTA all read from this one value.
  const style = { '--card-accent': game.accent }

  return (
    <Link to={game.path} className="game-card" style={style}>
      <span className="card-icon" aria-hidden="true">{game.icon}</span>
      <h2 className="card-title">{game.title}</h2>
      <p className="card-tagline">{game.tagline}</p>
      <span className="card-cta">Play <span aria-hidden="true">→</span></span>
    </Link>
  )
}
