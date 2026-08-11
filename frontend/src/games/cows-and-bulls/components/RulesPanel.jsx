import { useState } from 'react'

export default function RulesPanel() {
  // useState(false) means: "open" starts as false. Calling setOpen later
  // schedules a re-render with the new value - React handles the DOM update.
  const [open, setOpen] = useState(false)

  return (
    <div className="rules-panel">
      <button className="btn btn-ghost" onClick={() => setOpen((prev) => !prev)}>
        {open ? 'Hide rules' : 'How to play'}
      </button>
      {open && (
        <div className="rules-content">
          <p>The system picked a secret 3-digit number. Digits never repeat and it never starts with 0.</p>
          <ul>
            <li><strong className="text-bull">Bull</strong> - a digit is correct and in the correct position.</li>
            <li><strong className="text-cow">Cow</strong> - a digit is correct but in the wrong position.</li>
          </ul>
          <p>Example: secret is <code>123</code>. Guessing <code>132</code> gives 1 bull (the 1) and 2 cows (the 3 and 2, swapped).</p>
        </div>
      )}
    </div>
  )
}
