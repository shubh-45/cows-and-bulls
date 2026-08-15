import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import Celebration from '../../components/Celebration'
import StatsLine from '../../components/StatsLine'
import { useGameResult } from '../../lib/useGameResult'
import SnakeBoard, { steerFrom } from './Board'
import { DEATH, createState, step, tickInterval } from './engine'
import './Snake.css'

const KEY_DIRECTIONS = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  w: 'up', s: 'down', a: 'left', d: 'right',
  W: 'up', S: 'down', A: 'left', D: 'right',
}

const DEATH_TEXT = {
  [DEATH.WALL]: 'You hit the wall',
  [DEATH.SELF]: 'You ran into yourself',
  [DEATH.OPPONENT]: "You ran into your opponent",
  [DEATH.HEAD_ON]: 'Head-on crash',
}

const randomSeed = () => (Math.random() * 0xffffffff) >>> 0

export default function SnakeGame() {
  const [state, setState] = useState(() => createState(randomSeed(), 1))
  const [started, setStarted] = useState(false)
  const [paused, setPaused] = useState(false)

  // Inputs are buffered rather than applied straight to state. A player can
  // easily press two directions inside one tick; queueing them means the
  // second is honoured on the *next* tick instead of overwriting the first,
  // which is what stops a quick right-then-up from being swallowed.
  const inputQueue = useRef([])
  const stateRef = useRef(state)
  stateRef.current = state

  const snake = state.snakes[0]
  const over = state.status === 'over'
  const tickMs = tickInterval(state)

  const steer = useCallback((steerOrDir) => {
    const current = stateRef.current
    if (current.status === 'over') return
    const from = inputQueue.current.length
      ? inputQueue.current[inputQueue.current.length - 1]
      : current.snakes[0].dir
    const next = steerFrom(from, steerOrDir)
    if (next !== from && inputQueue.current.length < 2) inputQueue.current.push(next)
    setStarted(true)
  }, [])

  // The game loop, driven by requestAnimationFrame with a time accumulator.
  //
  // A setTimeout chain looks simpler but is wrong here: browsers clamp timers
  // to roughly once per second in tabs that aren't in the foreground, so the
  // game silently drops into slow motion instead of pausing - measured at
  // ~1000ms per tick against an intended 160ms. rAF stops altogether when the
  // tab isn't rendering, which is the behaviour we actually want.
  //
  // Accumulating elapsed real time (rather than stepping once per frame) keeps
  // the speed identical on 60Hz and 120Hz screens, and the cap stops a long
  // pause from being repaid as a burst of ticks the moment you return.
  useEffect(() => {
    if (!started || paused || over) return undefined

    let frame
    let last = performance.now()
    let accumulator = 0

    const loop = (now) => {
      accumulator = Math.min(accumulator + (now - last), 500)
      last = now

      const interval = tickInterval(stateRef.current)
      while (accumulator >= interval) {
        accumulator -= interval
        const dir = inputQueue.current.shift()
        setState((current) => step(current, dir ? { 0: dir } : {}))
      }
      frame = requestAnimationFrame(loop)
    }

    frame = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(frame)
  }, [started, paused, over])

  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === ' ') {
        event.preventDefault()
        setPaused((p) => !p)
        return
      }
      const dir = KEY_DIRECTIONS[event.key]
      if (!dir) return
      // Stop the arrow keys scrolling the page out from under the board.
      event.preventDefault()
      steer(dir)
    }
    window.addEventListener('keydown', onKeyDown, { passive: false })
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [steer])

  // Losing focus mid-run would otherwise mean coming back to a dead snake.
  useEffect(() => {
    function onHide() {
      if (document.hidden) setPaused(true)
    }
    document.addEventListener('visibilitychange', onHide)
    return () => document.removeEventListener('visibilitychange', onHide)
  }, [])

  function restart() {
    inputQueue.current = []
    setState(createState(randomSeed(), 1))
    setStarted(false)
    setPaused(false)
  }

  // Higher score is better here, unlike the puzzle games.
  useGameResult('snake', {
    ended: over,
    won: true, // solo Snake has no losing state - the run simply ends
    score: snake.score,
    lowerIsBetter: false,
  })

  return (
    <div className="page theme-snake">
      <Link to="/" className="back-link">← All games</Link>
      <header className="page-header">
        <p className="eyebrow">Arcade</p>
        <h1>Snake</h1>
        <p className="subtitle">Eat, grow, and don't hit anything. Walls are lethal.</p>
      </header>

      <main className="game-panel">
        <div className="snake-status">
          <span className="snake-score">
            <span className="snake-score-label">Score</span>
            <strong>{snake.score}</strong>
          </span>
          <span className="snake-score">
            <span className="snake-score-label">Length</span>
            <strong>{snake.body.length}</strong>
          </span>
          <button className="btn btn-ghost" onClick={restart}>New Game</button>
        </div>

        {over && <Celebration outcome={snake.score > 0 ? 'win' : 'lose'} />}

        <div className="snake-stage">
          <SnakeBoard state={state} tickMs={tickMs} onSteer={over ? null : steer} />

          {/* The result sits *on* the board rather than above it. A banner
              above pushed the board off the bottom of a phone screen, so you
              couldn't see the run you'd just lost without scrolling. */}
          {over && (
            <div className="snake-overlay is-result">
              <div className="snake-result-emoji">🐍</div>
              <p className="snake-result-score">{snake.score}</p>
              <p className="snake-overlay-copy">
                {DEATH_TEXT[snake.causeOfDeath] ?? 'Run over'} &middot; {snake.foodEaten} eaten
              </p>
              <StatsLine gameId="snake" formatBest={(n) => `${n} pts`} showStreak={false} />
              <button className="btn btn-primary" onClick={restart}>Play Again</button>
            </div>
          )}

          {!started && !over && (
            <div className="snake-overlay">
              <p className="snake-overlay-title">Tap to steer</p>
              <p className="snake-overlay-copy">
                Tap the <strong>left</strong> half to turn left, the
                <strong> right</strong> half to turn right. Arrow keys or WASD
                on a keyboard.
              </p>
              <button className="btn btn-primary" onClick={() => setStarted(true)}>Start</button>
            </div>
          )}

          {paused && started && !over && (
            <div className="snake-overlay">
              <p className="snake-overlay-title">Paused</p>
              <button className="btn btn-primary" onClick={() => setPaused(false)}>Resume</button>
            </div>
          )}
        </div>

        {/* An explicit pad for anyone who prefers buttons to tapping the board,
            and the only way to steer without covering the play area. */}
        <div className="snake-pad" aria-hidden={over}>
          <button className="pad-btn" onClick={() => steer('turn-left')} disabled={over}>
            ⟲ Left
          </button>
          <button className="pad-btn pad-pause" onClick={() => setPaused((p) => !p)} disabled={over || !started}>
            {paused ? 'Resume' : 'Pause'}
          </button>
          <button className="pad-btn" onClick={() => steer('turn-right')} disabled={over}>
            Right ⟳
          </button>
        </div>

        <details className="snake-rules">
          <summary>How to play</summary>
          <div className="rules-body">
            <p>
              Steer the snake into the food. Every piece makes you longer, and
              the longer you get the faster you move. Hitting a wall or your own
              body ends the run &mdash; there is no wrap-around.
            </p>
            <p>
              Food is worth <strong>10 points</strong>, rising to <strong>15</strong>
              once you are longer than 10 segments, so the risky end of a run is
              also the rewarding one.
            </p>
          </div>
        </details>
      </main>
    </div>
  )
}
