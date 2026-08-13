import { useEffect, useRef, useState } from 'react'
import { MAX_NAME_LENGTH } from '../lib/profile'
import { useProfile } from '../lib/useProfile'

// The player's name in the header, click to rename. Inline editing rather
// than a settings page - it's one field, and a whole screen for it would be
// more chrome than the feature deserves.
export default function ProfileChip() {
  const { profile, isRegistered, rename } = useProfile()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef(null)

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  if (!isRegistered) return null

  function open() {
    setDraft(profile.name)
    setEditing(true)
  }

  function commit(event) {
    event.preventDefault()
    rename(draft)
    setEditing(false)
  }

  if (editing) {
    return (
      <form className="profile-chip is-editing" onSubmit={commit}>
        <input
          ref={inputRef}
          className="profile-input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          maxLength={MAX_NAME_LENGTH}
          aria-label="Your display name"
          // commit on blur too, so clicking away doesn't silently discard it
          onBlur={commit}
          onKeyDown={(event) => event.key === 'Escape' && setEditing(false)}
          autoComplete="off"
        />
      </form>
    )
  }

  return (
    <button className="profile-chip" onClick={open} title="Change your name">
      <span className="profile-avatar" aria-hidden="true">
        {profile.name.charAt(0).toUpperCase()}
      </span>
      <span className="profile-name">{profile.name}</span>
    </button>
  )
}
