import { useState } from 'react'
import Celebration from './Celebration'
import './RoomShell.css'

/** Create / join screen, shared by every online game. */
export function RoomLobby({ onCreate, onJoin, busy, error, onExit }) {
  const [code, setCode] = useState('')

  return (
    <div className="online-lobby">
      <p className="online-intro">
        Play a friend on another device. Create a room and share the code, or
        type the code they sent you.
      </p>

      <button className="btn btn-primary online-create" onClick={onCreate} disabled={busy === 'create'}>
        {busy === 'create' ? 'Creating room…' : 'Create a room'}
      </button>

      <div className="online-divider"><span>or</span></div>

      <form
        className="online-join"
        onSubmit={(event) => {
          event.preventDefault()
          onJoin(code)
        }}
      >
        <input
          className="online-code-input"
          value={code}
          onChange={(event) => setCode(event.target.value.toUpperCase())}
          placeholder="CODE"
          maxLength={4}
          aria-label="Room code"
          autoComplete="off"
        />
        <button className="btn btn-ghost" type="submit" disabled={busy === 'join'}>
          {busy === 'join' ? 'Joining…' : 'Join'}
        </button>
      </form>

      {error && <p className="online-error">{error}</p>}

      <p className="online-note">
        The server sleeps when nobody is playing, so the first room of the day
        can take up to a minute to wake up.
      </p>

      <button className="mode-btn online-back" onClick={onExit}>← Back to offline play</button>
    </div>
  )
}

/** Code, running series score, opponent presence and the leave control. */
export function RoomHeader({ room, copied, onCopy, onLeave }) {
  const [confirming, setConfirming] = useState(false)
  const matchInProgress = room.status === 'PLAYING'

  function handleLeaveClick() {
    // Leaving mid-match hands the opponent the win, so it asks first. This is
    // the rage-quit guard: one stray tap should not end someone else's game.
    if (matchInProgress && !confirming) {
      setConfirming(true)
      return
    }
    onLeave()
  }

  return (
    <div className="room-header">
      <div className="room-top">
        <div className="online-code-block">
          <span className="online-code-label">Room</span>
          <button className="online-code" onClick={onCopy} title="Copy code">
            {room.code}
          </button>
          {copied && <span className="online-copied">Copied</span>}
        </div>

        <div className="room-actions">
          {confirming ? (
            <>
              <span className="room-confirm-text">Forfeit this match?</span>
              <button className="mode-btn is-danger" onClick={onLeave}>Leave</button>
              <button className="mode-btn" onClick={() => setConfirming(false)}>Stay</button>
            </>
          ) : (
            <button className="mode-btn" onClick={handleLeaveClick}>Leave</button>
          )}
        </div>
      </div>

      {room.opponentPresent && (
        <div className="room-series">
          <span className="series-chip series-you">
            <span className="series-label">You</span>
            <strong>{room.yourWins}</strong>
          </span>
          <span className="series-vs">
            {room.draws > 0 && <span className="series-draws">{room.draws} drawn</span>}
            <span className="series-match">Match {room.matchNumber}</span>
          </span>
          <span className="series-chip series-them">
            <strong>{room.theirWins}</strong>
            <span className="series-label">
              {room.opponentName || 'Friend'}
              <span
                className={`presence-dot ${room.opponentOnline ? 'is-online' : 'is-offline'}`}
                title={room.opponentOnline ? 'Online' : 'Not responding'}
                aria-hidden="true"
              />
            </span>
          </span>
        </div>
      )}

      {room.opponentPresent && !room.opponentOnline && room.status !== 'ABANDONED' && (
        <p className="room-warning">
          {room.opponentName || 'Your friend'} isn't responding — they may have
          lost connection or closed the tab.
        </p>
      )}
    </div>
  )
}

/**
 * Everything shown once a match ends: the result, the rematch handshake, and
 * the case where the opponent has walked out for good.
 */
export function MatchResult({ room, result, onRematch, onLeave, busy }) {
  if (room.status === 'ABANDONED') {
    const youLeft = room.abandonedBy === 'you'
    return (
      <div className="reward-banner tier-participant">
        <div className="reward-emoji">👋</div>
        <h2>{youLeft ? 'You left the room' : `${room.opponentName || 'Your friend'} left`}</h2>
        <p className="reward-secret">
          {room.lastMatchForfeited && !youLeft
            ? 'That match was awarded to you.'
            : 'The room is closed.'}
        </p>
        <p className="series-final">
          Final series &mdash; you {room.yourWins}, {room.opponentName || 'them'} {room.theirWins}
          {room.draws > 0 ? `, ${room.draws} drawn` : ''}
        </p>
        <button className="btn btn-primary" onClick={onLeave}>Back to lobby</button>
      </div>
    )
  }

  return (
    <>
      <Celebration outcome={result.outcome} />
      <div className={`reward-banner ${result.tier}`} aria-live="polite">
        <div className="reward-emoji">{result.emoji}</div>
        <h2>{result.title}</h2>
        {result.detail && <p className="reward-secret">{result.detail}</p>}

        <p className="series-final">
          Series &mdash; you {room.yourWins}, {room.opponentName || 'them'} {room.theirWins}
          {room.draws > 0 ? `, ${room.draws} drawn` : ''}
        </p>

        {room.opponentWantsRematch && !room.youWantRematch && (
          <p className="rematch-nudge">
            {room.opponentName || 'Your friend'} wants a rematch!
          </p>
        )}

        <div className="rematch-actions">
          {room.youWantRematch ? (
            <span className="rematch-waiting">
              Waiting for {room.opponentName || 'your friend'} to accept…
            </span>
          ) : (
            <button
              className="btn btn-primary"
              onClick={onRematch}
              disabled={busy === 'rematch' || !room.opponentOnline}
            >
              {busy === 'rematch' ? 'Asking…' : 'Rematch'}
            </button>
          )}
          <button className="mode-btn" onClick={onLeave}>Leave room</button>
        </div>

        {!room.opponentOnline && (
          <p className="rematch-note">
            Rematch needs {room.opponentName || 'your friend'} to be connected.
          </p>
        )}
      </div>
    </>
  )
}
