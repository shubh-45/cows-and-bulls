import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { createProfile, loadProfile, recordResult, saveProfile } from './profile'

// One shared profile for the whole app. Context rather than each game reading
// localStorage directly, so a new result re-renders every screen that shows
// it, and there's a single source of truth in memory.
//
// There is no rename. The name is chosen once on the welcome screen and is
// final on this device: it gets copied into an online room at create/join and
// the server treats it as fixed for that room's lifetime, so allowing a change
// afterwards would let the two players' screens disagree about who is who.
const ProfileContext = createContext(null)

export function ProfileProvider({ children }) {
  // Lazy initialiser: reads storage once on mount instead of on every render.
  const [profile, setProfile] = useState(() => loadProfile())

  const register = useCallback((name) => {
    setProfile(saveProfile(createProfile(name)))
  }, [])

  // Games call this once when a round ends. It's a no-op before the player
  // has picked a name, so a game can call it unconditionally.
  const submitResult = useCallback((gameId, result) => {
    setProfile((current) => (current ? recordResult(current, gameId, result) : current))
  }, [])

  const value = useMemo(
    () => ({ profile, isRegistered: Boolean(profile), register, submitResult }),
    [profile, register, submitResult]
  )

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>
}

export function useProfile() {
  const context = useContext(ProfileContext)
  if (!context) throw new Error('useProfile must be used inside a ProfileProvider')
  return context
}
