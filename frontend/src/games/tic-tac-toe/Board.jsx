import { EMPTY, SIZE, X } from './logic'

// Shared by the offline and online screens so both render an identical board
// and there is only one place to change how a mark looks.

const STROKE_LENGTH_X = 80 // the diagonal of the 22..78 box, rounded up
const STROKE_LENGTH_O = 176 // circumference of r=28

export function Mark({ player }) {
  if (player === X) {
    return (
      <svg className="ttt-mark ttt-mark-x" viewBox="0 0 100 100" aria-hidden="true">
        <line x1="24" y1="24" x2="76" y2="76" style={{ '--len': STROKE_LENGTH_X }} />
        <line x1="76" y1="24" x2="24" y2="76" style={{ '--len': STROKE_LENGTH_X }} />
      </svg>
    )
  }
  return (
    <svg className="ttt-mark ttt-mark-o" viewBox="0 0 100 100" aria-hidden="true">
      <circle cx="50" cy="50" r="28" style={{ '--len': STROKE_LENGTH_O }} />
    </svg>
  )
}

/**
 * Small inline X/O for status rows.
 *
 * Deliberately does NOT carry the .ttt-mark class: that class sizes a mark to
 * fill its board cell and drives the draw-on animation, neither of which suits
 * a 15px badge that re-renders on every poll tick.
 */
export function Badge({ player }) {
  return (
    <svg className="ttt-badge" viewBox="0 0 100 100" aria-hidden="true">
      {player === X ? (
        <>
          <line x1="20" y1="20" x2="80" y2="80" stroke="var(--mark-x)" strokeWidth="16" strokeLinecap="round" />
          <line x1="80" y1="20" x2="20" y2="80" stroke="var(--mark-x)" strokeWidth="16" strokeLinecap="round" />
        </>
      ) : (
        <circle cx="50" cy="50" r="30" fill="none" stroke="var(--mark-o)" strokeWidth="16" />
      )}
    </svg>
  )
}

// Cell centres as percentages, so the strike-through lands on the middle of
// the first and last winning squares whatever size the board is rendered at.
const centre = (index) => ({
  x: (index % SIZE) * (100 / SIZE) + 100 / SIZE / 2,
  y: Math.floor(index / SIZE) * (100 / SIZE) + 100 / SIZE / 2,
})

export function WinningLine({ winner }) {
  if (!winner) return null
  const from = centre(winner.line[0])
  const to = centre(winner.line[winner.line.length - 1])
  return (
    <svg
      className={`ttt-strike ${winner.player === X ? 'win-x' : 'win-o'}`}
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} />
    </svg>
  )
}

/**
 * @param {number[]} board      flat 9-cell array
 * @param {object|null} winner  `{ player, line }` once someone has won
 * @param {(index:number)=>void} onPlay
 * @param {(index:number)=>boolean} canPlay
 * @param {number|null} lastMove
 */
export default function Board({ board, winner, onPlay, canPlay, lastMove }) {
  const winSet = new Set(winner ? winner.line : [])
  const winClass = winner ? (winner.player === X ? 'win-x' : 'win-o') : ''

  return (
    <div className="ttt-board-wrap">
      <div className="ttt-board" role="grid" aria-label="Tic-Tac-Toe board">
        {board.map((cell, index) => {
          const playable = cell === EMPTY && canPlay(index)
          const isWinning = winSet.has(index)
          // Once there is a winner, everything outside the line recedes.
          const dimmed = winner && cell !== EMPTY && !isWinning
          return (
            <button
              key={index}
              type="button"
              role="gridcell"
              className={[
                'ttt-cell',
                playable ? 'is-playable' : '',
                isWinning ? `is-winning ${winClass}` : '',
                dimmed ? 'is-dimmed' : '',
                lastMove === index && !winner ? 'is-last' : '',
              ].filter(Boolean).join(' ')}
              onClick={() => playable && onPlay(index)}
              disabled={!playable}
              aria-label={
                cell === EMPTY
                  ? `Row ${Math.floor(index / SIZE) + 1}, column ${(index % SIZE) + 1}, empty`
                  : `Row ${Math.floor(index / SIZE) + 1}, column ${(index % SIZE) + 1}, ${cell === X ? 'X' : 'O'}`
              }
            >
              {cell !== EMPTY && <Mark player={cell} />}
            </button>
          )
        })}
      </div>
      <WinningLine winner={winner} />
    </div>
  )
}
