import { useState } from 'react'
import { GAMES } from '../data/gamesCatalog'
import { MAX_NAME_LENGTH } from '../lib/profile'
import { useProfile } from '../lib/useProfile'
import './WelcomeGate.css'

const LIVE_GAME_COUNT = GAMES.filter((game) => game.status === 'live').length

// Shown once, on a player's first visit, before anything else. Deliberately
// a single question with a skip - asking for more (email, password) would
// cost far more players than the name is worth, and nothing here leaves the
// browser anyway.
export default function WelcomeGate() {
  const { isRegistered, register } = useProfile()
  const [name, setName] = useState('')

  if (isRegistered) return null

  function handleSubmit(event) {
    event.preventDefault()
    register(name)
  }

  return (
    <div className="welcome-backdrop" role="dialog" aria-modal="true" aria-labelledby="welcome-title">
      <div className="welcome-card">
        <span className="welcome-mark" aria-hidden="true">🕹️</span>
        <p className="welcome-eyebrow">Welcome to</p>
        <h1 id="welcome-title" className="welcome-title">The Arcade</h1>
        {/* counted from the catalog so this line can't go stale as games
            are added or removed */}
        <p className="welcome-copy">
          {LIVE_GAME_COUNT} games, no accounts, no installs. Pick a name so we
          can keep your streaks and personal bests.
        </p>

        <form className="welcome-form" onSubmit={handleSubmit}>
          <label className="welcome-label" htmlFor="welcome-name">
            What should we call you?
          </label>
          <input
            id="welcome-name"
            className="welcome-input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Player"
            maxLength={MAX_NAME_LENGTH}
            autoComplete="off"
            autoFocus
          />
          <button className="btn btn-primary welcome-submit" type="submit">
            Start playing
          </button>
        </form>

        <button className="welcome-skip" type="button" onClick={() => register('Player')}>
          Skip for now
        </button>

        <p className="welcome-note">
          Stored only on this device. Nothing is uploaded, and there's no sign-up.
        </p>
      </div>
    </div>
  )
}
