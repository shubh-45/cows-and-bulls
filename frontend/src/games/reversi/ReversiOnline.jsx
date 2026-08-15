import { MatchResult, RoomHeader, RoomLobby } from '../../components/RoomShell'
import { useRoom } from '../../lib/useRoom'
import {
  BLACK,
  EMPTY,
  applyMove,
  cellToIndex,
  colorForRole,
  countDiscs,
  flipsForMove,
  legalMoves,
  nextTurn,
  replayMoves,
} from './logic'

// Room plumbing - polling, rematch, presence, leaving - lives in useRoom and
// RoomShell, shared with Tic-Tac-Toe. What remains here needs Reversi's rules.
export default function ReversiOnline({ onExit }) {
  const { room, playerId, error, busy, copied, create, join, submitMove, rematch, leave, copyCode } =
    useRoom('reversi')

  if (!room) {
    return <RoomLobby onCreate={create} onJoin={join} busy={busy} error={error} onExit={onExit} />
  }

  // Black moves first, and the room alternates who starts between matches, so
  // colour follows the starting role rather than host/guest.
  const myColor = colorForRole(room.yourRole, room.startingRole)
  const { board, over: rulesOver } = replayMoves(room.moves, room.startingRole)
  const { black, white } = countDiscs(board)
  const myDiscs = myColor === BLACK ? black : white
  const theirDiscs = myColor === BLACK ? white : black

  const waiting = room.status === 'WAITING'
  const abandoned = room.status === 'ABANDONED'
  const finished = room.status === 'FINISHED' || abandoned || rulesOver
  const myTurn = room.yourTurn && !waiting && !finished
  const moves = myTurn ? legalMoves(board, myColor) : []
  const legalSet = new Set(moves.map((m) => `${m.row},${m.col}`))
  const lastMove = room.moves.length ? room.moves[room.moves.length - 1].index : null

  function play(row, col) {
    if (!myTurn) return
    const flips = flipsForMove(board, row, col, myColor)
    if (flips.length === 0) return

    // Work out the consequences locally so the server can be told whose turn
    // is next and whether the match ended. Only the client knows Reversi's
    // pass rule, which is why the server takes this on trust.
    const nextBoard = applyMove(board, row, col, myColor, flips)
    const turn = nextTurn(nextBoard, myColor)

    let winnerRole = null
    if (turn.over) {
      const counts = countDiscs(nextBoard)
      const mine = myColor === BLACK ? counts.black : counts.white
      const theirs = myColor === BLACK ? counts.white : counts.black
      const otherRole = room.yourRole === 'host' ? 'guest' : 'host'
      winnerRole = mine > theirs ? room.yourRole : mine < theirs ? otherRole : 'draw'
    }

    submitMove({
      index: cellToIndex(row, col),
      // The server defaults to "the other player" when this is null, so the
      // only case worth naming is Reversi's pass - the opponent has no legal
      // move, so the turn comes straight back to me.
      nextPlayerId: turn.player === myColor ? playerId : null,
      gameOver: turn.over,
      winnerRole,
      resultNote: turn.over ? 'Board complete' : null,
    })
  }

  let result = null
  if (finished && !abandoned) {
    if (myDiscs > theirDiscs) {
      result = { outcome: 'win', emoji: '🏆', title: 'You win!', tier: 'tier-gold', detail: `${myDiscs} – ${theirDiscs}` }
    } else if (myDiscs < theirDiscs) {
      result = {
        outcome: 'lose',
        emoji: '🫡',
        title: `${room.opponentName || 'Your friend'} wins`,
        tier: 'tier-silver',
        detail: `${myDiscs} – ${theirDiscs}`,
      }
    } else {
      result = { outcome: 'draw', emoji: '🤝', title: "It's a draw", tier: 'tier-participant', detail: `${myDiscs} – ${theirDiscs}` }
    }
  }

  return (
    <div className="online-room">
      <RoomHeader room={room} copied={copied} onCopy={copyCode} onLeave={leave} />

      {waiting && (
        <p className="online-share">
          Send <strong>{room.code}</strong> to your friend. They pick Reversi →
          Online → Join.
        </p>
      )}

      <div className="reversi-status">
        <span className={`score-chip ${myTurn ? 'is-turn' : ''}`}>
          <span className={`disc ${myColor === BLACK ? 'disc-black' : 'disc-white'} disc-chip`} aria-hidden="true" />
          <strong>{myDiscs}</strong> You
        </span>
        <span className="score-chip">
          <span className={`disc ${myColor === BLACK ? 'disc-white' : 'disc-black'} disc-chip`} aria-hidden="true" />
          <strong>{theirDiscs}</strong> {room.opponentName || 'Friend'}
        </span>
      </div>

      {!finished && (
        <p className="reversi-turn" aria-live="polite">
          {waiting
            ? 'Waiting for your friend to join…'
            : myTurn
            ? 'Your move'
            : `Waiting for ${room.opponentName || 'your friend'}…`}
        </p>
      )}

      {error && <p className="online-error">{error}</p>}

      {(result || abandoned) && (
        <MatchResult room={room} result={result} onRematch={rematch} onLeave={leave} busy={busy} />
      )}

      <div className="reversi-board" role="grid" aria-label="Reversi board">
        {board.map((rowCells, row) =>
          rowCells.map((cell, col) => {
            const isLegal = legalSet.has(`${row},${col}`)
            const isLast = lastMove === cellToIndex(row, col)
            return (
              <button
                key={`${row}-${col}`}
                type="button"
                role="gridcell"
                className={`reversi-cell ${isLegal ? 'is-legal' : ''} ${isLast ? 'is-last' : ''}`}
                onClick={() => play(row, col)}
                disabled={!isLegal}
                aria-label={`row ${row + 1} column ${col + 1}`}
              >
                {cell !== EMPTY && (
                  <span className={`disc ${cell === BLACK ? 'disc-black' : 'disc-white'}`} />
                )}
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}
