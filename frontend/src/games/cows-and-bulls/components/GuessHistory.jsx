// This component receives a list of past attempts as a prop and turns each
// one into a row. Using .map() to turn an array of data into an array of
// JSX elements is the single most common pattern in React.
export default function GuessHistory({ history }) {
  if (history.length === 0) {
    return <p className="empty-state">No guesses yet - your first attempt appears here.</p>
  }

  return (
    <ol className="history-list">
      {/* newest attempt first */}
      {[...history].reverse().map((attempt) => (
        // React needs a stable "key" on list items so it can track which
        // row is which across re-renders. attemptNumber is unique per game.
        <li key={attempt.attemptNumber} className="history-row">
          <span className="attempt-number">#{attempt.attemptNumber}</span>
          <span className="guess-digits">
            {attempt.guess.split('').map((digit, i) => (
              <span className="digit-tile" key={i}>{digit}</span>
            ))}
          </span>
          <span className="pegs" title={`${attempt.bulls} bull(s), ${attempt.cows} cow(s)`}>
            {Array.from({ length: attempt.bulls }).map((_, i) => (
              <span className="peg peg-bull" key={`b${i}`} />
            ))}
            {Array.from({ length: attempt.cows }).map((_, i) => (
              <span className="peg peg-cow" key={`c${i}`} />
            ))}
          </span>
          <span className="score-text">
            {attempt.bulls} bull{attempt.bulls !== 1 ? 's' : ''} · {attempt.cows} cow{attempt.cows !== 1 ? 's' : ''}
          </span>
        </li>
      ))}
    </ol>
  )
}
