import { useProfile } from '../lib/useProfile'

// The player's name, shown as a label. It is set once on the welcome screen
// and is final from then on - there is deliberately no rename. That keeps the
// name a player registers with an online room identical to the one their
// opponent sees for the life of that room, with no way for the two screens to
// disagree.
export default function ProfileChip() {
  const { profile, isRegistered } = useProfile()

  if (!isRegistered) return null

  return (
    <span className="profile-chip">
      <span className="profile-avatar" aria-hidden="true">
        {profile.name.charAt(0).toUpperCase()}
      </span>
      <span className="profile-name">{profile.name}</span>
    </span>
  )
}
