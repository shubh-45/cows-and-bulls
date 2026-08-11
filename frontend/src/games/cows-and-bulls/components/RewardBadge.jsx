// A plain JS object used as a lookup table - keeps the JSX below free of
// if/else chains. This "config object" pattern is very common in React.
const TIERS = {
  GOLD: { label: 'Gold - Code Breaker', emoji: '🥇', className: 'tier-gold' },
  SILVER: { label: 'Silver - Sharp Eye', emoji: '🥈', className: 'tier-silver' },
  BRONZE: { label: 'Bronze - Got There', emoji: '🥉', className: 'tier-bronze' },
  PARTICIPANT: { label: 'Solved - Keep Practicing', emoji: '🎯', className: 'tier-participant' },
}

export default function RewardBadge({ result, onPlayAgain }) {
  const tier = TIERS[result.rewardTier] ?? TIERS.PARTICIPANT

  return (
    <div className={`reward-banner ${tier.className}`}>
      <div className="reward-emoji">{tier.emoji}</div>
      <h2>Cracked it in {result.attemptCount} attempt{result.attemptCount !== 1 ? 's' : ''}!</h2>
      <p className="reward-tier-label">{tier.label}</p>
      <p className="reward-secret">The code was <strong>{result.secretNumber}</strong></p>
      <button className="btn btn-primary" onClick={onPlayAgain}>
        Play Again
      </button>
    </div>
  )
}
