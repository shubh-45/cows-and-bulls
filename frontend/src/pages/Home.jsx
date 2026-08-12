import { Link } from 'react-router-dom'
import { GAMES } from '../data/gamesCatalog'
import './Home.css'

// The hub is the storefront, so it gets more visual energy than the game
// screens do: a gradient hero and cards that lean hard on each game's own
// accent color. Splitting live from coming-soon keeps the playable games
// above the fold instead of interleaving them with placeholders.
export default function Home() {
  const liveGames = GAMES.filter((g) => g.status === 'live')
  const soonGames = GAMES.filter((g) => g.status !== 'live')

  return (
    <div className="page home">
      <section className="hub-hero">
        <p className="hub-eyebrow">The Arcade</p>
        <h1 className="hub-title">Pick a game</h1>
        <p className="hub-tagline">
          A small, growing collection of logic and word games. No installs, no
          accounts &mdash; just play.
        </p>
        <p className="hub-meta">
          <span><strong>{liveGames.length}</strong> playable now</span>
          <span className="hub-meta-sep" aria-hidden="true" />
          <span><strong>{soonGames.length}</strong> in the works</span>
        </p>
      </section>

      <section className="hub-section">
        <h2 className="hub-section-title">Now Playing</h2>
        <div className="game-grid">
          {liveGames.map((game) => (
            <GameCard key={game.id} game={game} />
          ))}
        </div>
      </section>

      {soonGames.length > 0 && (
        <section className="hub-section">
          <h2 className="hub-section-title">Coming Soon</h2>
          <div className="game-grid">
            {soonGames.map((game) => (
              <GameCard key={game.id} game={game} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function GameCard({ game }) {
  const isLive = game.status === 'live'
  // CSS custom property set inline so each card can drive its own accent -
  // icon chip, glow, border and CTA all read from this one value.
  const style = { '--card-accent': game.accent }

  const content = (
    <>
      <span className="card-icon" aria-hidden="true">{game.icon}</span>
      <h3 className="card-title">{game.title}</h3>
      <p className="card-tagline">{game.tagline}</p>
      {isLive ? (
        <span className="card-cta">Play <span aria-hidden="true">→</span></span>
      ) : (
        <span className="badge-soon">Coming soon</span>
      )}
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
