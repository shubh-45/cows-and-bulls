import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { createProfile, loadProfile, recordResult, saveProfile, sanitizeName } from './profile'

// One shared profile for the whole app. Context rather than each game reading
// localStorage directly, so a name change or a new result re-renders every
// screen that shows it, and there's a single source of truth in memory.
const ProfileContext = createContext(null)

export function ProfileProvider({ children }) {
  // Lazy initialiser: reads storage once on mount instead of on every render.
  const [profile, setProfile] = useState(() => loadProfile())

  // Your name is copied into a room when you create or join it, and the
  // server treats it as fixed for that room's lifetime. Renaming afterwards
  // would leave your opponent staring at the old name with no way to correct
  // it, so online play holds the name still until you leave.
  const [nameLocked, setNameLocked] = useState(false)

  const register = useCallback((name) => {
    setProfile(saveProfile(createProfile(name)))
  }, [])

  const rename = useCallback(
    (name) => {
      if (nameLocked) return
      setProfile((current) => {
        if (!current) return current
        const clean = sanitizeName(name)
        if (!clean) return current
        return saveProfile({ ...current, name: clean })
      })
    },
    [nameLocked]
  )

  // Games call this once when a round ends. It's a no-op before the player
  // has picked a name, so a game can call it unconditionally.
  const submitResult = useCallback((gameId, result) => {
    setProfile((current) => (current ? recordResult(current, gameId, result) : current))
  }, [])

  const value = useMemo(
    () => ({
      profile,
      isRegistered: Boolean(profile),
      register,
      rename,
      submitResult,
      nameLocked,
      setNameLocked,
    }),
    [profile, register, rename, submitResult, nameLocked]
  )

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>
}

export function useProfile() {
  const context = useContext(ProfileContext)
  if (!context) throw new Error('useProfile must be used inside a ProfileProvider')
  return context
}
