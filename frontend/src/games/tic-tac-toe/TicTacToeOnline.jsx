import { MatchResult, RoomHeader, RoomLobby } from '../../components/RoomShell'
import { useRoom } from '../../lib/useRoom'
import Board, { Badge } from './Board'
import { X, markForRole, replayMoves } from './logic'

// All the room plumbing - polling, rematch, presence, leaving - lives in
// useRoom and RoomShell, shared with Reversi. What is left here is only the
// part that needs Tic-Tac-Toe's rules.
export default function TicTacToeOnline({ onExit }) {
  const { room, error, busy, copied, create, join, submitMove, rematch, leave, copyCode } =
    useRoom('tic-tac-toe')

  if (!room) {
    return <RoomLobby onCreate={create} onJoin={join} busy={busy} error={error} onExit={onExit} />
  }

  // Sides follow whoever starts this match, and the room alternates that
  // between matches - so a series does not favour whoever made the room.
  const myMark = markForRole(room.yourRole, room.startingRole)
  const { board, winner, over } = replayMoves(room.moves, room.startingRole)

  const waiting = room.status === 'WAITING'
  const abandoned = room.status === 'ABANDONED'
  const finished = room.status === 'FINISHED' || abandoned || over
  const myTurn = room.yourTurn && !waiting && !finished
  const lastMove = room.moves.length ? room.moves[room.moves.length - 1].index : null

  function play(index) {
    if (!myTurn) return

    // Replay with this move appended to see whether it ends the match. The
    // server holds no copy of the rules, so it is told the outcome - but it
    // still independently rejects a move out of turn, off the board, or onto
    // a square already played.
    const projected = replayMoves([...room.moves, { index, role: room.yourRole }], room.startingRole)
    const winnerRole = projected.winner
      ? projected.winner.player === myMark
        ? room.yourRole
        : room.yourRole === 'host' ? 'guest' : 'host'
      : 'draw'

    submitMove({
      index,
      // Tic-Tac-Toe has no pass rule, so the turn always goes to the other
      // player - exactly what the server assumes when this is null.
      nextPlayerId: null,
      gameOver: projected.over,
      winnerRole: projected.over ? winnerRole : null,
      resultNote: projected.winner ? `${projected.winner.player === X ? 'X' : 'O'} wins` : 'Board full',
    })
  }

  let result = null
  if (finished && !abandoned) {
    if (!winner) {
      result = { outcome: 'draw', emoji: '🤝', title: "It's a draw", tier: 'tier-participant' }
    } else if (winner.player === myMark) {
      result = { outcome: 'win', emoji: '🏆', title: 'You win!', tier: 'tier-gold' }
    } else {
      result = {
        outcome: 'lose',
        emoji: '🫡',
        title: `${room.opponentName || 'Your friend'} wins`,
        tier: 'tier-silver',
      }
    }
  }

  return (
    <div className="online-room">
      <RoomHeader room={room} copied={copied} onCopy={copyCode} onLeave={leave} />

      {waiting && (
        <p className="online-share">
          Send <strong>{room.code}</strong> to your friend. They pick Tic-Tac-Toe
          → Online → Join.
        </p>
      )}

      <div className="ttt-status">
        <span className={`ttt-turn ${myMark === X ? 'is-x' : 'is-o'}`}>
          <Badge player={myMark} />
          You are <strong>{myMark === X ? 'X' : 'O'}</strong>
        </span>
        {!finished && !waiting && (
          <span className="ttt-turn">
            {myTurn ? 'Your move' : `Waiting for ${room.opponentName || 'your friend'}…`}
          </span>
        )}
      </div>

      {error && <p className="online-error">{error}</p>}

      {(result || abandoned) && (
        <MatchResult room={room} result={result} onRematch={rematch} onLeave={leave} busy={busy} />
      )}

      <Board
        board={board}
        winner={winner}
        onPlay={play}
        canPlay={() => myTurn}
        lastMove={lastMove}
      />
    </div>
  )
}
