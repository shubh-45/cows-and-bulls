import { useEffect, useRef } from 'react'
import { ARENA, CELL, EVENT, TANK_R } from './engine'

// The arena, drawn in arena units - the SVG viewBox IS the arena, so nothing
// here has to know about pixels or screen size.
//
// Effects play from the event list the referee ships in each snapshot, so both
// screens show the same explosions without either having to simulate them.
// They are pure decoration: nothing in this file can change the match.

const FX_LIFE_MS = 900

function Crate({ col, row, cracked }) {
  const x = col * ARENA.cell
  const y = row * ARENA.cell
  const c = ARENA.cell
  return (
    <g className={`tk-crate ${cracked ? 'is-cracked' : ''}`}>
      <rect x={x + 0.3} y={y + 0.3} width={c - 0.6} height={c - 0.6} rx={1} className="tk-crate-shell" />
      <rect x={x + 1.4} y={y + 1.4} width={c - 2.8} height={c - 2.8} rx={0.7} className="tk-crate-face" />
      <path
        className="tk-crate-seam"
        d={`M${x + 1.4} ${y + c / 2}H${x + c - 1.4}M${x + c / 2} ${y + 1.4}V${y + c - 1.4}`}
      />
      {/* A lit top edge and nothing on the bottom is what gives it thickness. */}
      <path className="tk-crate-lit" d={`M${x + 0.3} ${y + 0.3}H${x + c - 0.3}L${x + c - 1.4} ${y + 1.4}H${x + 1.4}Z`} />
      {[[2.1, 2.1], [c - 2.1, 2.1], [2.1, c - 2.1], [c - 2.1, c - 2.1]].map(([bx, by], i) => (
        <circle key={i} cx={x + bx} cy={y + by} r={0.55} className="tk-crate-bolt" />
      ))}
      {cracked && (
        <path
          className="tk-crate-crack"
          d={`M${x + 2.4} ${y + 0.6}L${x + 4.6} ${y + 4.2}L${x + 3.1} ${y + 5.8}L${x + 5.6} ${y + 9.4}M${x + 7.4} ${y + 0.6}L${x + 6.3} ${y + 3.6}L${x + 8.1} ${y + 5.4}L${x + 7} ${y + 9.4}`}
        />
      )}
    </g>
  )
}

function Steel({ col, row }) {
  const x = col * ARENA.cell
  const y = row * ARENA.cell
  const c = ARENA.cell
  const k = 1.9
  return (
    <g className="tk-steel">
      <path
        className="tk-steel-body"
        d={`M${x + k} ${y}H${x + c - k}L${x + c} ${y + k}V${y + c - k}L${x + c - k} ${y + c}H${x + k}L${x} ${y + c - k}V${y + k}Z`}
      />
      <path
        className="tk-steel-lit"
        d={`M${x + k} ${y}H${x + c - k}L${x + c} ${y + k}L${x + c - 1.3} ${y + k}L${x + c - k - 0.5} ${y + 0.9}H${x + k + 0.5}Z`}
      />
      <path className="tk-steel-line" d={`M${x + 1.6} ${y + 3.4}H${x + c - 1.6}M${x + 1.6} ${y + 6.6}H${x + c - 1.6}`} />
      <circle cx={x + c / 2} cy={y + c / 2} r={1.3} className="tk-steel-rivet" />
    </g>
  )
}

function Barrel({ col, row }) {
  const cx = (col + 0.5) * ARENA.cell
  const cy = (row + 0.5) * ARENA.cell
  return (
    <g className="tk-barrel">
      <circle cx={cx} cy={cy} r={4.3} className="tk-barrel-body" />
      <circle cx={cx} cy={cy} r={3} className="tk-barrel-ring" />
      <circle cx={cx} cy={cy} r={1.5} className="tk-barrel-core" />
    </g>
  )
}

const deg = (radians) => (radians * 180) / Math.PI

function Tank({ tank, tone, mine }) {
  return (
    <g className={`tk-tank tk-${tone} ${tank.alive ? '' : 'is-dead'}`} transform={`translate(${tank.x} ${tank.y})`}>
      {/* Hull and treads turn with the heading; the turret is its own group, so
          you can reverse away while still aiming where you were. */}
      <g transform={`rotate(${deg(tank.heading)})`}>
        <rect x={-4.6} y={-4.4} width={9.2} height={2.5} rx={0.8} className="tk-tread" />
        <rect x={-4.6} y={1.9} width={9.2} height={2.5} rx={0.8} className="tk-tread" />
        <path
          className="tk-tread-rung"
          d={[-3.4, -2.1, -0.8, 0.5, 1.8, 3.1].map((o) => `M${o} -4.3v2.3M${o} 2v2.3`).join('')}
        />
        <rect x={-4} y={-2.6} width={8} height={5.2} rx={1.1} className="tk-hull" />
        <rect x={-2.6} y={-1.5} width={5.2} height={3} rx={0.7} className="tk-hull-plate" />
      </g>
      <g transform={`rotate(${deg(tank.turret)})`}>
        <rect x={1.9} y={-0.62} width={5.4} height={1.24} rx={0.5} className="tk-gun" />
        <rect x={6.9} y={-1} width={1.5} height={2} rx={0.4} className="tk-gun" />
      </g>
      <circle r={2.3} className="tk-turret" />
      <circle r={0.8} cx={-0.7} className="tk-hatch" />
      {mine && <circle r={TANK_R + 1.4} className="tk-mine-ring" />}
    </g>
  )
}

export default function TankBoard({ state, localSeat = 0, aimPath = null, palette = ['p1', 'p2'] }) {
  const fx = useRef([])
  const seenTick = useRef(-1)

  useEffect(() => {
    if (state.tick === seenTick.current) return
    seenTick.current = state.tick
    const born = performance.now()
    let n = 0
    for (const event of state.events ?? []) {
      fx.current.push({ ...event, born, key: `${state.tick}-${n++}` })
    }
  }, [state.tick, state.events])

  // Pruned on render rather than on a timer: this component already redraws
  // every animation frame, so a timer would only be more moving parts.
  const now = performance.now()
  fx.current = fx.current.filter((f) => now - f.born < FX_LIFE_MS)

  const cells = []
  for (let row = 0; row < ARENA.rows; row++) {
    for (let col = 0; col < ARENA.cols; col++) {
      const type = state.grid[row * ARENA.cols + col]
      if (type === CELL.EMPTY) continue
      const key = `${col}-${row}`
      if (type === CELL.STEEL) cells.push(<Steel key={key} col={col} row={row} />)
      else if (type === CELL.BARREL) cells.push(<Barrel key={key} col={col} row={row} />)
      else cells.push(<Crate key={key} col={col} row={row} cracked={type === CELL.CRATE_HIT} />)
    }
  }

  return (
    <svg className="tk-layer" viewBox={`0 0 ${ARENA.w} ${ARENA.h}`} aria-hidden="true">
      <rect x={0} y={0} width={ARENA.w} height={ARENA.h} className="tk-floor" />
      {cells}

      {aimPath && aimPath.length > 1 && (
        <g className="tk-aim">
          <polyline points={aimPath.map((p) => `${p.x},${p.y}`).join(' ')} />
          {aimPath.filter((p) => p.bounce).map((p, i) => (
            <circle key={i} cx={p.x} cy={p.y} r={1.6} className="tk-aim-bounce" />
          ))}
        </g>
      )}

      {state.shells.map((shell) => (
        <g key={shell.id} className="tk-shell">
          <line x1={shell.x - shell.vx * 0.04} y1={shell.y - shell.vy * 0.04} x2={shell.x} y2={shell.y} />
          <circle cx={shell.x} cy={shell.y} r={1.1} />
        </g>
      ))}

      {state.tanks.map((tank, i) => (
        <Tank key={tank.id} tank={tank} tone={palette[i] ?? 'p1'} mine={i === localSeat} />
      ))}

      {fx.current.map((f) => {
        if (f.e === EVENT.CRATE_BREAK) return <circle key={f.key} className="fx-break" cx={f.x} cy={f.y} r={5} />
        if (f.e === EVENT.BLAST) return <circle key={f.key} className="fx-blast" cx={f.x} cy={f.y} r={6} />
        if (f.e === EVENT.TANK_HIT) return <circle key={f.key} className="fx-kill" cx={f.x} cy={f.y} r={6} />
        if (f.e === EVENT.BOUNCE) return <circle key={f.key} className="fx-spark" cx={f.x} cy={f.y} r={1.5} />
        if (f.e === EVENT.FIRE) return <circle key={f.key} className="fx-muzzle" cx={f.x} cy={f.y} r={2.4} />
        return null
      })}
    </svg>
  )
}
