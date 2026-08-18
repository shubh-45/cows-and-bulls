import { useCallback, useEffect, useRef, useState } from 'react'
import {
  createRoom,
  fetchRoom,
  joinRoom,
  leaveRoom,
  requestRematch,
  sendGuess,
  sendMove,
  wakeBackend,
} from './roomsApi'
import { useProfile } from './useProfile'

const POLL_MS = 1500

/**
 * Everything about being in a room: creating, joining, polling, moving,
 * offering a rematch and leaving.
 *
 * Reversi and Tic-Tac-Toe were running near-identical copies of this, which is
 * two places to fix every bug. The only genuinely game-specific part is what a
 * move means, so `submitMove` takes the outcome the caller worked out from its
 * own rules and this hook handles the rest.
 */
export function useRoom(gameType) {
  const { profile } = useProfile()
  const [room, setRoom] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [copied, setCopied] = useState(false)

  // Mirrored in a ref so the poll loop can skip unchanged responses without
  // being rebuilt (and restarting its timer) on every render.
  const versionRef = useRef(0)

  // Wake the sleeping free instance while the player is still reading the
  // lobby, so the 30-60s cold start overlaps with them rather than stalling
  // their first click.
  useEffect(() => {
    wakeBackend()
  }, [])

  const adopt = useCallback((next) => {
    versionRef.current = next.version
    setRoom(next)
    setError('')
  }, [])

  const refresh = useCallback(async () => {
    if (!room?.code || !profile) return
    try {
      const next = await fetchRoom(room.code, profile.id)
      if (next.version !== versionRef.current) {
        versionRef.current = next.version
        setRoom(next)
      }
    } catch (err) {
      setError(err.message)
    }
  }, [room?.code, profile])

  // Polling continues while a match is FINISHED, which is the whole point:
  // that is exactly when the opponent might offer a rematch, and stopping
  // here would leave their offer invisible. Only a room somebody has walked
  // out of has nothing left to report.
  useEffect(() => {
    if (!room?.code || room.status === 'ABANDONED') return undefined
    const timer = setInterval(refresh, POLL_MS)
    return () => clearInterval(timer)
  }, [room?.code, room?.status, refresh])

  const create = useCallback(async () => {
    setBusy('create')
    setError('')
    try {
      adopt(await createRoom({ gameType, playerId: profile.id, playerName: profile.name }))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy('')
    }
  }, [gameType, profile, adopt])

  const join = useCallback(
    async (rawCode) => {
      const code = String(rawCode).trim().toUpperCase()
      if (code.length < 4) {
        setError('Room codes are 4 characters.')
        return
      }
      setBusy('join')
      setError('')
      try {
        adopt(await joinRoom(code, { playerId: profile.id, playerName: profile.name }))
      } catch (err) {
        setError(err.message)
      } finally {
        setBusy('')
      }
    },
    [profile, adopt]
  )

  /**
   * @param {object} outcome `{ index, nextPlayerId, gameOver, winnerRole, resultNote }`
   *   worked out by the caller from its own rules.
   */
  const submitMove = useCallback(
    async (outcome) => {
      if (!room?.code) return
      try {
        adopt(await sendMove(room.code, { playerId: profile.id, ...outcome }))
      } catch (err) {
        setError(err.message)
        // Re-sync: a rejected move usually means this client's picture of the
        // room is stale, and the truth is one fetch away.
        refresh()
      }
    },
    [room?.code, profile, adopt, refresh]
  )

  /**
   * One Cows & Bulls turn. Returns the guess as the server scored it, so the
   * caller can react to its own result without waiting for the next poll.
   */
  const submitGuess = useCallback(
    async (guess) => {
      if (!room?.code) return null
      try {
        const next = await sendGuess(room.code, { playerId: profile.id, guess })
        adopt(next)
        return next
      } catch (err) {
        setError(err.message)
        // A rejected guess usually means this client's picture of the room is
        // stale - most often that the turn already moved on.
        refresh()
        return null
      }
    },
    [room?.code, profile, adopt, refresh]
  )

  const rematch = useCallback(async () => {
    if (!room?.code) return
    setBusy('rematch')
    try {
      adopt(await requestRematch(room.code, profile.id))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy('')
    }
  }, [room?.code, profile, adopt])

  const leave = useCallback(async () => {
    if (room?.code) {
      try {
        await leaveRoom(room.code, profile.id)
      } catch {
        // Best effort. The room expires on its own, and the opponent's
        // presence timeout will notice regardless.
      }
    }
    setRoom(null)
    versionRef.current = 0
    setError('')
  }, [room?.code, profile])

  const copyCode = useCallback(() => {
    if (!room?.code) return
    navigator.clipboard?.writeText(room.code).then(
      () => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1600)
      },
      () => setError('Could not copy - read the code out instead.')
    )
  }, [room?.code])

  return {
    room,
    // Exposed because Reversi's pass rule needs to name *this* player as the
    // next mover; every other case can leave nextPlayerId null and let the
    // server default to the opponent.
    playerId: profile?.id ?? null,
    error,
    busy,
    copied,
    create,
    join,
    submitMove,
    submitGuess,
    rematch,
    leave,
    copyCode,
    refresh,
  }
}
