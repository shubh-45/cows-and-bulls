// One object per game. `status: 'live'` makes the card clickable and links
// to `path`. `status: 'coming-soon'` renders it greyed out with a badge -
// a easy way to show your roadmap on the hub itself. `accent` becomes that
// game's signature color, both on its card and inside the game screen.
export const GAMES = [
  {
    id: 'cows-and-bulls',
    title: 'Cows & Bulls',
    tagline: 'Crack a hidden 3-digit code using pure logic.',
    icon: '🔢',
    accent: '#f2b705',
    path: '/games/cows-and-bulls',
    status: 'live',
  },
  {
    id: 'rock-paper-scissors',
    title: 'Rock · Paper · Scissors',
    tagline: 'Best of odd rounds against the machine.',
    icon: '✊',
    accent: '#c084fc',
    path: '/games/rock-paper-scissors',
    status: 'live',
  },
  {
    id: 'high-low',
    title: 'Higher or Lower',
    tagline: 'Home in on a hidden number from 1-100.',
    icon: '🎯',
    accent: '#4ade80',
    path: '/games/high-low',
    status: 'live',
  },
  {
    id: 'memory-match',
    title: 'Memory Match',
    tagline: 'Flip cards, find every pair, beat your best time.',
    icon: '🃏',
    accent: '#f472b6',
    path: '/games/memory-match',
    status: 'live',
  },
  {
    id: 'tic-tac-toe',
    title: 'Tic-Tac-Toe',
    tagline: 'Classic 3x3 grid battle vs the computer.',
    icon: '⭕',
    accent: '#60a5fa',
    status: 'coming-soon',
  },
  {
    id: 'hangman',
    title: 'Hangman',
    tagline: 'Guess the word one letter at a time.',
    icon: '📝',
    accent: '#fb923c',
    status: 'coming-soon',
  },
  {
    id: 'wordle',
    title: 'Wordle Clone',
    tagline: 'Five letters, six guesses, tile-color feedback.',
    icon: '🟩',
    accent: '#34d399',
    status: 'coming-soon',
  },
  {
    id: 'quiz-arena',
    title: 'Quiz Arena',
    tagline: 'Multi-category trivia with a running score.',
    icon: '❓',
    accent: '#818cf8',
    status: 'coming-soon',
  },
]
