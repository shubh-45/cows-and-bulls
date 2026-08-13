import { useEffect, useRef } from 'react'
import { useProfile } from './useProfile'

/**
 * Records a finished round exactly once.
 *
 * A game's "you won" state survives many re-renders - every hover, every
 * animation frame - so recording inline would inflate the played count and
 * the streak. The ref latches on the first render where `ended` is true and
 * only unlatches when a new round starts, which is the one signal that
 * reliably means "this is a different game now".
 */
export function useGameResult(gameId, { ended, won, score = null, lowerIsBetter = true }) {
  const { submitResult } = useProfile()
  const recorded = useRef(false)

  useEffect(() => {
    if (!ended) {
      recorded.current = false
      return
    }
    if (recorded.current) return
    recorded.current = true
    submitResult(gameId, { won, score, lowerIsBetter })
  }, [gameId, ended, won, score, lowerIsBetter, submitResult])
}
