import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import Celebration from '../../components/Celebration'
import StatsLine from '../../components/StatsLine'
import { useGameResult } from '../../lib/useGameResult'
import SnakeBoard, { steerFrom } from './Board'
import SnakeDuel from './SnakeDuel'
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

const ARROW_ROTATION = { up: 0, right: 90, down: 180, left: 270 }

/**
 * A straight direction arrow, drawn rather than typed so it stays crisp at any
 * size. One shape rotated four ways, so all four arrows are identical.
 */
function DirArrow({ direction }) {
  return (
    <svg
      className="dir-arrow"
      viewBox="0 0 24 24"
      aria-hidden="true"
      style={{ transform: `rotate(${ARROW_ROTATION[direction]}deg)` }}
    >
      <path
        d="M12 19 V6.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <path
        d="M6.5 12 L12 6 L17.5 12"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export default function SnakeGame() {
  const [state, setState] = useState(() => createState(randomSeed(), 1))
  const [started, setStarted] = useState(false)
  const [paused, setPaused] = useState(false)
  const [duel, setDuel] = useState(false)

  // Inputs are buffered rather than applied straight to state. A player can
  // easily press two directions inside one tick; queueing them means the
  // second is honoured on the *next* tick instead of overwriting the first,
  // which is what stops a quick right-then-up from being swallowed.
  const inputQueue = useRef([])
  const stateRef = useRef(state)
  stateRef.current = state

  // The queue itself is a ref, so it can't drive rendering. This mirrors the
  // direction most recently accepted purely so the head can face it right
  // away - the body still doesn't move until the next tick.
  const [pendingDir, setPendingDir] = useState(null)

  const snake = state.snakes[0]
  const over = state.status === 'over'

  const steer = useCallback((steerOrDir) => {
    const current = stateRef.current
    if (current.status === 'over') return
    const from = inputQueue.current.length
      ? inputQueue.current[inputQueue.current.length - 1]
      : current.snakes[0].dir
    const next = steerFrom(from, steerOrDir)
    if (next !== from && inputQueue.current.length < 2) {
      inputQueue.current.push(next)
      setPendingDir(next)
    }
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
        // Once consumed, the head goes back to following the body unless
        // another input is already waiting behind it.
        if (dir) setPendingDir(inputQueue.current[0] ?? null)
        setState((current) => step(current, dir ? { 0: dir } : {}))
      }
      frame = requestAnimationFrame(loop)
    }

    frame = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(frame)
  }, [started, paused, over])

  // Not while the duel is showing: this component stays mounted behind it, and
  // the handler preventDefaults W/A/S/D and space - which is exactly what made
  // room codes containing those letters impossible to type in the duel lobby.
  useEffect(() => {
    if (duel) return undefined

    function onKeyDown(event) {
      // Never steal a keystroke aimed at a text field.
      const tag = event.target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || event.target?.isContentEditable) return

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
  }, [steer, duel])

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
    setPendingDir(null)
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
        {duel ? (
          <SnakeDuel onExit={() => setDuel(false)} />
        ) : (
        <>
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
          <SnakeBoard
            state={state}
            onSteer={over ? null : steer}
            facing={pendingDir}
          />

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

        {/* A four-way pad for anyone who prefers buttons to touching the play
            area. These are absolute directions, so the arrows are straight -
            pressing up sends the snake up, whichever way it was going. A
            reversal is ignored by the engine rather than being fatal. */}
        <div className="snake-pad">
          <button className="pad-btn pad-up" onClick={() => steer('up')} disabled={over} aria-label="Up">
            <DirArrow direction="up" />
          </button>
          <button className="pad-btn pad-left" onClick={() => steer('left')} disabled={over} aria-label="Left">
            <DirArrow direction="left" />
          </button>
          <button
            className="pad-btn pad-pause"
            onClick={() => setPaused((p) => !p)}
            disabled={over || !started}
          >
            {paused ? 'Resume' : 'Pause'}
          </button>
          <button className="pad-btn pad-right" onClick={() => steer('right')} disabled={over} aria-label="Right">
            <DirArrow direction="right" />
          </button>
          <button className="pad-btn pad-down" onClick={() => steer('down')} disabled={over} aria-label="Down">
            <DirArrow direction="down" />
          </button>
        </div>

        <div className="snake-modes">
          <button className="mode-btn is-active">Solo</button>
          <button className="mode-btn" onClick={() => setDuel(true)}>Duel a friend</button>
        </div>
        </>
        )}

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
