import { HashRouter, Routes, Route, Link } from 'react-router-dom'
import Home from './pages/Home'
import CowsAndBullsGame from './games/cows-and-bulls/CowsAndBullsGame'
import HighLowGame from './games/high-low/HighLowGame'
import MemoryMatchGame from './games/memory-match/MemoryMatchGame'
import WordleGame from './games/wordle/WordleGame'
import ReversiGame from './games/reversi/ReversiGame'
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
    <HashRouter>
      <div className="site">
        <nav className="site-nav">
          <Link to="/" className="brand">
            <span className="brand-mark">🕹️</span> The Arcade
          </Link>
        </nav>

        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/games/cows-and-bulls" element={<CowsAndBullsGame />} />
          <Route path="/games/high-low" element={<HighLowGame />} />
          <Route path="/games/memory-match" element={<MemoryMatchGame />} />
          <Route path="/games/wordle" element={<WordleGame />} />
          <Route path="/games/reversi" element={<ReversiGame />} />
        </Routes>
      </div>
    </HashRouter>
  )
}
