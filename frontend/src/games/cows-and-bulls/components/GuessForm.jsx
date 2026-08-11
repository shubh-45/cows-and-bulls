import { useState } from 'react'

// A "controlled input" just means: the input's value lives in React state
// (the `value` variable below), and every keystroke updates that state via
// onChange. React re-renders the input with the new value. This is the
// standard way to read form data in React.
export default function GuessForm({ onSubmit, disabled }) {
  const [value, setValue] = useState('')
  const [localError, setLocalError] = useState('')

  function validate(guess) {
    if (guess.length !== 3) return 'Enter exactly 3 digits'
    if (guess[0] === '0') return "Can't start with 0"
    if (new Set(guess.split('')).size !== 3) return 'Digits must not repeat'
    return ''
  }

  function handleChange(e) {
    // Only keep digits, cap at 3 characters
    const next = e.target.value.replace(/\D/g, '').slice(0, 3)
    setValue(next)
    setLocalError('')
  }

  function handleSubmit(e) {
    e.preventDefault() // stop the browser's default "reload the page" form behaviour
    const error = validate(value)
    if (error) {
      setLocalError(error)
      return
    }
    onSubmit(value)
    setValue('')
  }

  return (
    <form className="guess-form" onSubmit={handleSubmit}>
      <input
        className="guess-input"
        inputMode="numeric"
        autoComplete="off"
        placeholder="123"
        value={value}
        onChange={handleChange}
        disabled={disabled}
        aria-label="Enter your 3-digit guess"
      />
      <button className="btn btn-primary" type="submit" disabled={disabled}>
        Guess
      </button>
      {localError && <p className="field-error">{localError}</p>}
    </form>
  )
}
