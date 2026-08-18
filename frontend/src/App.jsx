import { HashRouter, Routes, Route, Link } from 'react-router-dom'
import Home from './pages/Home'
import CowsAndBullsGame from './games/cows-and-bulls/CowsAndBullsGame'
import HighLowGame from './games/high-low/HighLowGame'
import MemoryMatchGame from './games/memory-match/MemoryMatchGame'
import WordleGame from './games/wordle/WordleGame'
import ReversiGame from './games/reversi/ReversiGame'
import TicTacToeGame from './games/tic-tac-toe/TicTacToeGame'
import SnakeGame from './games/snake/SnakeGame'
import TanksGame from './games/tanks/TanksGame'
import ProfileChip from './components/ProfileChip'
import WelcomeGate from './components/WelcomeGate'
import { ProfileProvider } from './lib/useProfile'
import './App.css'

// react-router-dom swaps out the <Routes> content based on the URL path,
// without a full page reload - that's what makes this a "single page app".
// Each <Route> just says "when the URL matches this path, render this
// component". Add a new game to the site by adding one line here plus an
// entry in data/gamesCatalog.js.
export default function App() {
  return (
    // HashRouter (URLs like /#/games/cows-and-bulls) instead of BrowserRouter
    // is a deliberate choice: it needs zero server configuration on static
    // hosts like Vercel/Netlify, so refreshing mid-game never 404s. Once you
    // outgrow free static hosting you can switch to BrowserRouter and add
    // your host's SPA rewrite rule.
    <ProfileProvider>
    <HashRouter>
      <div className="site">
        {/* Blocks the app until the player has picked a name - once only,
            then never seen again on this device. */}
        <WelcomeGate />

        <nav className="site-nav">
          <div className="site-nav-inner">
            <Link to="/" className="brand">
              <span className="brand-mark" aria-hidden="true">🕹️</span>
              <span className="brand-text">The Arcade</span>
            </Link>
            <ProfileChip />
          </div>
        </nav>

        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/games/cows-and-bulls" element={<CowsAndBullsGame />} />
          <Route path="/games/high-low" element={<HighLowGame />} />
          <Route path="/games/memory-match" element={<MemoryMatchGame />} />
          <Route path="/games/wordle" element={<WordleGame />} />
          <Route path="/games/reversi" element={<ReversiGame />} />
          <Route path="/games/tic-tac-toe" element={<TicTacToeGame />} />
          <Route path="/games/snake" element={<SnakeGame />} />
          <Route path="/games/tanks" element={<TanksGame />} />
        </Routes>
      </div>
    </HashRouter>
    </ProfileProvider>
  )
}
