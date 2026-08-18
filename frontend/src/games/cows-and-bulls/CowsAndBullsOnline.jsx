import { MatchResult, RoomHeader, RoomLobby } from '../../components/RoomShell'
import { useRoom } from '../../lib/useRoom'
import GuessForm from './components/GuessForm'
import GuessHistory from './components/GuessHistory'

/**
 * Two players, one hidden code, alternate turns.
 *
 * The room plumbing - polling, rematch, presence, leaving - is the same
 * useRoom and RoomShell that Reversi and Tic-Tac-Toe use. What is different
 * here is who does the thinking: those games replay a shared move list and
 * work the board out on the client, and this one cannot. The server holds the
 * code, so the server scores every guess, and it hands each player only their
 * own. The opponent's guesses are not hidden in the payload - they are never
 * sent, or the answer would be one devtools tab away.
 */
export default function CowsAndBullsOnline({ onExit }) {
  const { room, error, busy, copied, create, join, submitGuess, rematch, leave, copyCode } =
    useRoom('cows-and-bulls')

  if (!room) {
    return <RoomLobby onCreate={create} onJoin={join} busy={busy} error={error} onExit={onExit} />
  }

  const waiting = room.status === 'WAITING'
  const abandoned = room.status === 'ABANDONED'
  const finished = room.status === 'FINISHED' || abandoned
  const myTurn = room.yourTurn && !waiting && !finished

  // The server speaks in seq; the history component that the solo game uses
  // speaks in attemptNumber. Same rows, so both modes read identically.
  const history = (room.yourGuesses ?? []).map((g) => ({
    attemptNumber: g.seq,
    guess: g.guess,
    cows: g.cows,
    bulls: g.bulls,
  }))
  const theirTurns = room.opponentGuessCount ?? 0
  const solved = history.some((h) => h.bulls === 3)

  let result = null
  if (finished && !abandoned) {
    const them = room.opponentName || 'They'
    result =
      room.lastResult === 'draw'
        ? { outcome: 'draw', emoji: '🤝', title: 'Dead heat',
            tier: 'tier-participant', detail: `You both cracked ${room.secret}` }
        : room.lastResult === 'you'
        ? { outcome: 'win', emoji: '🎯', title: 'Cracked it',
            tier: 'tier-gold', detail: `The code was ${room.secret}` }
        : { outcome: 'lose', emoji: '🔒', title: `${them} got there first`,
            tier: 'tier-silver', detail: `The code was ${room.secret}` }
  }

  return (
    <div className="online-room">
      <RoomHeader room={room} copied={copied} onCopy={copyCode} onLeave={leave} />

      {waiting && (
        <p className="online-share">
          Send <strong>{room.code}</strong> to your friend. They pick Cows &amp; Bulls
          → Online → Join.
        </p>
      )}

      {!waiting && !finished && (
        <div className="cb-versus">
          <span className={`cb-turn ${myTurn ? 'is-mine' : ''}`}>
            {myTurn ? 'Your guess' : `${room.opponentName || 'Your friend'} is guessing…`}
          </span>
          <span className="cb-tally">
            {/* A count and nothing else. How close they are is theirs to know. */}
            you {history.length} · them {theirTurns}
          </span>
        </div>
      )}

      {!waiting && !finished && (
        <p className="cb-online-note">
          You are both hunting the <strong>same code</strong>, turn by turn — but you
          only ever see your own guesses.
        </p>
      )}

      {error && <p className="online-error">{error}</p>}

      {(result || abandoned) && (
        <MatchResult room={room} result={result} onRematch={rematch} onLeave={leave} busy={busy} />
      )}

      {!finished && (
        <>
          <GuessForm onSubmit={submitGuess} disabled={!myTurn} />
          {/* Solving does not end it on the spot: whoever went second must get
              the same number of turns, or starting first would decide it. */}
          {solved && (
            <p className="cb-online-note">
              You have it. {room.opponentName || 'Your friend'} gets an equalising guess —
              match it and you draw.
            </p>
          )}
        </>
      )}

      <GuessHistory history={history} />
    </div>
  )
}
