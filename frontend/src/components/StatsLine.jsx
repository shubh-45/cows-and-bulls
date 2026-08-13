import { getGameStats } from '../lib/profile'
import { useProfile } from '../lib/useProfile'
import './StatsLine.css'

/**
 * The "what this win did for you" line inside a reward banner. Reads from the
 * profile in localStorage, so it works with the backend asleep and survives a
 * refresh - which is the whole point of keeping stats client-side.
 *
 * `formatBest` turns a raw number into that game's own units ("4 guesses",
 * "12 moves"), since every game measures something different.
 */
export default function StatsLine({ gameId, formatBest }) {
  const { profile } = useProfile()
  if (!profile) return null

  const stats = getGameStats(profile, gameId)
  if (stats.played === 0) return null

  const items = []
  if (stats.streak > 1) items.push({ label: 'Streak', value: `${stats.streak} 🔥` })
  if (stats.bestStreak > 1) items.push({ label: 'Best streak', value: stats.bestStreak })
  if (stats.best !== null) {
    items.push({ label: 'Personal best', value: formatBest ? formatBest(stats.best) : stats.best })
  }
  items.push({ label: 'Played', value: stats.played })

  return (
    <dl className="stats-line">
      {items.map((item) => (
        <div className="stats-item" key={item.label}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}
