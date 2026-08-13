import { useMemo } from 'react'
import './Celebration.css'

// Pure CSS particles - no canvas, no library, nothing added to the bundle but
// this file. Each piece is a div animating transform and opacity only, which
// the compositor handles on the GPU, so even 60 of them stay smooth on a
// phone. Nothing here touches the server.

const WIN_COLORS = ['#f2b705', '#f472b6', '#38bdf8', '#34d399', '#818cf8', '#fb923c']

function useParticles(count, build) {
  // useMemo so the random values are rolled once. Without it every re-render
  // (each poll tick, in Reversi's case) would reshuffle the particles and the
  // animation would visibly restart.
  return useMemo(() => Array.from({ length: count }, (_, i) => build(i)), [count, build])
}

function Confetti() {
  const pieces = useParticles(60, (i) => ({
    id: i,
    left: Math.random() * 100,
    delay: Math.random() * 2.2,
    duration: 2.6 + Math.random() * 2,
    drift: (Math.random() - 0.5) * 140,
    spin: 540 + Math.random() * 720,
    color: WIN_COLORS[i % WIN_COLORS.length],
    width: 6 + Math.random() * 5,
    height: 10 + Math.random() * 8,
    round: Math.random() > 0.7,
  }))

  return (
    <div className="celebration celebration-win" aria-hidden="true">
      {pieces.map((p) => (
        <span
          key={p.id}
          className={`confetti ${p.round ? 'is-round' : ''}`}
          style={{
            left: `${p.left}%`,
            width: `${p.width}px`,
            height: `${p.height}px`,
            background: p.color,
            '--drift': `${p.drift}px`,
            '--spin': `${p.spin}deg`,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
          }}
        />
      ))}
    </div>
  )
}

// Deliberately not confetti-in-reverse. Slow embers rising reads as the game
// settling rather than as the screen mocking you - the loser still gets
// motion and a sense of closure, just a quieter one.
function Embers({ tone }) {
  const motes = useParticles(26, (i) => ({
    id: i,
    left: Math.random() * 100,
    delay: Math.random() * 3,
    duration: 4.5 + Math.random() * 3,
    drift: (Math.random() - 0.5) * 80,
    size: 4 + Math.random() * 6,
  }))

  return (
    <div className={`celebration celebration-${tone}`} aria-hidden="true">
      {motes.map((m) => (
        <span
          key={m.id}
          className="ember"
          style={{
            left: `${m.left}%`,
            width: `${m.size}px`,
            height: `${m.size}px`,
            '--drift': `${m.drift}px`,
            animationDelay: `${m.delay}s`,
            animationDuration: `${m.duration}s`,
          }}
        />
      ))}
    </div>
  )
}

/**
 * @param {'win' | 'lose' | 'draw'} outcome
 */
export default function Celebration({ outcome }) {
  if (outcome === 'win') return <Confetti />
  return <Embers tone={outcome === 'draw' ? 'draw' : 'lose'} />
}
