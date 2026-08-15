// One object per game. `accent` becomes that game's signature color, both on
// its card and inside the game screen.
//
// Order matters: this array is the hub grid, top to bottom - listed
// most-engaging first, so the meatier games lead and the simplest one
// (Higher or Lower) sits last.
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
    id: 'wordle',
    title: 'Wordle Clone',
    tagline: 'Five letters, six guesses, tile-color feedback.',
    icon: '🟩',
    accent: '#34d399',
    path: '/games/wordle',
    status: 'live',
  },
  {
    id: 'reversi',
    title: 'Reversi',
    tagline: 'Outflank and flip discs to own the board.',
    icon: '⚫',
    accent: '#38bdf8',
    path: '/games/reversi',
    status: 'live',
  },
  {
    id: 'tic-tac-toe',
    title: 'Tic-Tac-Toe',
    tagline: 'Three in a row, versus the computer or a friend.',
    icon: '⭕',
    accent: '#60a5fa',
    path: '/games/tic-tac-toe',
    status: 'live',
  },
  {
    id: 'snake',
    title: 'Snake',
    tagline: 'Eat, grow, and never hit the wall.',
    icon: '🐍',
    accent: '#4ade80',
    path: '/games/snake',
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
    id: 'high-low',
    title: 'Higher or Lower',
    tagline: 'Home in on a hidden number from 1-100.',
    icon: '🎯',
    accent: '#4ade80',
    path: '/games/high-low',
    status: 'live',
  },
]
