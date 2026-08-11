# The Arcade — Spring Boot + React pet project

A small multi-game hub. Cows & Bulls (a number-deduction game) is the flagship
and the only one backed by a Spring Boot API — the game logic lives server
side, the React frontend is a thin client that renders state and calls the
API. Rock-Paper-Scissors and Higher-or-Lower are pure frontend games with no
backend involved, added as quick wins and as examples of React state without
any API calls.

```
cows-and-bulls/
├── backend/    Spring Boot API (Java 17, Maven) — powers Cows & Bulls only
└── frontend/   React app (Vite) — the hub + all games
    └── src/
        ├── App.jsx              site shell: nav bar + route table
        ├── pages/Home.jsx       the hub / game picker
        ├── data/gamesCatalog.js single source of truth for the hub grid
        └── games/
            ├── cows-and-bulls/          talks to the Spring Boot API
            ├── rock-paper-scissors/     fully client-side
            └── high-low/                fully client-side
```

### Adding a new game

1. Make a folder under `src/games/<your-game>/` with a `<YourGame>.jsx` and
   its own `.css` file.
2. Give its top-level wrapper a `theme-<your-game>` class and set `--accent`
   on it (see `games/high-low/HighLow.css` for the minimal example) — that's
   what makes it visually distinct on the hub and in the game itself.
3. Add a `<Route>` for it in `App.jsx`.
4. Add an entry to `data/gamesCatalog.js` with `status: 'live'` — it appears
   on the hub automatically.

Reuse what's in `App.css` (`.page`, `.game-panel`, `.btn`, `.reward-banner`,
`.history-section`, etc.) rather than redefining it — those are shared across
every game precisely so a new one doesn't need its own boilerplate.

---

## 1. Install what you need (macOS)

You said Spring Boot is already set up, so skip straight to the React section
if Java/Maven are working for you already.

### Homebrew (if you don't have it)
```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

### Java 17+ and Maven (for the backend)
```bash
brew install openjdk@17 maven
java -version   # confirm it prints 17.x
mvn -version
```

### Node.js (for the React frontend)
Use `nvm` (Node Version Manager) rather than installing Node directly — it
lets you switch Node versions per project later, which you will eventually
need.
```bash
brew install nvm
mkdir ~/.nvm
echo 'export NVM_DIR="$HOME/.nvm"' >> ~/.zshrc
echo '[ -s "/opt/homebrew/opt/nvm/nvm.sh" ] && \. "/opt/homebrew/opt/nvm/nvm.sh"' >> ~/.zshrc
source ~/.zshrc

nvm install --lts
nvm use --lts
node -v    # confirm it prints a version
npm -v
```

### Editor
VS Code is the standard choice for React: https://code.visualstudio.com/
Install the "ES7+ React/Redux/React-Native snippets" extension once you're
comfortable with the basics — not required to start.

---

## 2. Run the backend

```bash
cd cows-and-bulls/backend
mvn spring-boot:run
```
This starts the API at `http://localhost:8080`. Leave this terminal running.

Quick sanity check in another terminal:
```bash
curl -X POST http://localhost:8080/api/games
# {"gameId":"...", "message":"New game started..."}
```

## 3. Run the frontend

```bash
cd cows-and-bulls/frontend
npm install     # downloads React, Vite, etc. into node_modules (only needed once)
npm run dev
```
Vite prints a URL, normally `http://localhost:5173`. Open it in your browser.
You should see the game and be able to play a full round against the backend
you started in step 2.

**If you get a CORS error in the browser console:** it means the backend's
allowed-origins list doesn't include the URL your frontend is actually
running on. Check `backend/src/main/resources/application.properties` —
`app.cors.allowed-origins` defaults to `http://localhost:5173`. If Vite picked
a different port (it will tell you), update that property or set the
`CORS_ALLOWED_ORIGINS` env var.

---

## 4. How the pieces fit together (React basics)

If backend is familiar territory, here's the mental model for the frontend:

- **Components** are functions that return HTML-like syntax called JSX
  (`App.jsx`, `GuessForm.jsx`, etc). Think of them like methods that render a
  fragment of UI — composable and reusable, similar to how you'd break a
  backend service into smaller classes.
- **Props** are how a parent component passes data down to a child — like
  function arguments. `<GuessHistory history={history} />` passes the
  `history` array into that component.
- **State** (`useState`) is data a component "remembers" between renders —
  the equivalent of instance fields on an object, except updating it
  (`setHistory(...)`) tells React "please re-render whatever depends on
  this." You never mutate state directly; you always call the setter.
- **Effects** (`useEffect`) run side effects (API calls, subscriptions) in
  response to a component appearing or its dependencies changing. `App.jsx`
  uses one to start a new game the moment the page loads — the frontend
  equivalent of an `@PostConstruct`.
- **One-way data flow**: state lives in `App.jsx`, gets passed down as props,
  and children call functions (also passed as props, like `onSubmit`) to ask
  the parent to change that state. Nothing below `App` mutates state
  directly — it all flows back up through callbacks. This is the single
  biggest mental shift coming from backend code.
- **The API layer** (`src/api/gameApi.js`) is just `fetch()` calls returning
  JSON — no different from calling a REST API from any other client. CORS
  (`CorsConfig.java` on the backend) exists because your React dev server
  (`localhost:5173`) and your API (`localhost:8080`) are different origins as
  far as the browser is concerned, and browsers block cross-origin requests
  by default unless the server explicitly allows them.

Read `App.jsx` first, then follow the props down into the components — the
comments in each file explain the pattern being used.

---

## 5. The reward system, and how to extend it

Right now, `GameService.rewardTierFor()` maps attempt count to a tier:

| Attempts | Tier |
|---|---|
| 1–5 | 🥇 Gold |
| 6–8 | 🥈 Silver |
| 9–12 | 🥉 Bronze |
| 13+ | 🎯 Participant |

Ideas to make it richer, roughly in order of effort:

1. **Timer bonus** — record `Instant.now()` when the game starts, compute
   elapsed time on win, and factor it into the tier (or show it separately —
   "solved in 5 guesses, 42 seconds").
2. **Hint system with a cost** — let the player request one digit's position
   as a hint, but knock them down a tier or add +2 "effective attempts" per
   hint used. Good exercise in adding a new endpoint + new game state.
3. **Streaks** — track consecutive wins in `localStorage` on the frontend
   (simplest) or tie it to a player identity on the backend (more realistic,
   needs basic auth or at least a player name).
4. **Leaderboard** — persist finished games (attempts, time, date) to a real
   database instead of the in-memory `ConcurrentHashMap`. This is the natural
   next step once you want data to survive a server restart — swap `Game`
   storage for a JPA repository + H2 (file-based, still free/local) or
   Postgres (free tier on Render, see below).
5. **Difficulty levels** — 4-digit or 5-digit secret numbers as a "hard mode"
   toggle sent when starting a game (`POST /api/games?digits=4`).
6. **Optimal-play comparison** — the information-theoretic minimum for this
   game is about 5 guesses with perfect play. You could show "you took 7,
   optimal play averages ~5" instead of fixed tiers.

---

## 6. More game ideas (roughly easiest → hardest, good learning progression)

Rock-Paper-Scissors and Higher-or-Lower are already built (see
`src/games/`) — both are good reference examples for a game with no backend
at all. `data/gamesCatalog.js` is the live roadmap: anything marked
`'coming-soon'` there is fair game to pick up next.

1. **Tic-Tac-Toe vs a simple AI** — introduces recursion/minimax on the
   backend if you want the AI to be unbeatable, or just random-legal-move AI
   to start.
4. **Memory / Concentration (card matching)** — good practice for arrays of
   objects, `key` props, and CSS animations (card flip).
5. **Hangman** — backend picks a word, frontend renders blanks and a
   keyboard; similar API shape to this project.
6. **Quiz App** — categories, score tracking, could pull questions from a
   `questions` table instead of hardcoding them — natural intro to a real
   database.
7. **Wordle clone** — significantly more state/logic than Cows & Bulls (5
   letters, keyboard color feedback, daily-word mode) — a good "level 2"
   project once this one feels easy.
8. **Snake or 2048** — canvas/grid-based, mostly frontend logic, minimal
   backend (maybe just a high-score endpoint). Good if you want to explore
   `<canvas>` or CSS grid animations.

---

## 7. Deploying for free

As of mid-2026, the most beginner-friendly free combination with **no credit
card required** is:

- **Backend → [Render](https://render.com)** — free "Web Service", deploys
  straight from a GitHub repo, detects Maven/Spring Boot automatically. The
  catch: free services spin down after ~15 minutes of no traffic, so the
  first request after idling takes 30–60 seconds to wake up (fine for a pet
  project/demo, not for something you need instantly responsive).
- **Frontend → [Vercel](https://vercel.com) or [Netlify](https://netlify.com)**
  — both have generous, genuinely free static hosting for a Vite/React build,
  deploy from GitHub, no credit card, no spin-down (static files are always
  instantly served).

Railway and Fly.io are also popular, but as of 2026 Railway's free allowance
is quite small (a few hours/month) and Fly.io now requires a card even for
its free allowance — Render avoids both issues for a project this size.

### Steps

1. Push `cows-and-bulls/` to a GitHub repo (backend and frontend can be one
   repo with two folders, like this project already is).
2. **Render (backend):**
   - New → Web Service → connect your repo, root directory `backend`.
   - Environment: Java. Build command: `mvn clean package -DskipTests`.
     Start command: `java -jar target/cows-and-bulls-0.0.1-SNAPSHOT.jar`.
   - Add an environment variable `CORS_ALLOWED_ORIGINS` set to your Vercel
     URL once you have it (step 3) — comma-separate multiple origins if
     needed.
   - Deploy. Note the URL Render gives you, e.g. `https://cows-and-bulls-api.onrender.com`.
3. **Vercel (frontend):**
   - New Project → import the same repo → set root directory to `frontend`.
   - Framework preset: Vite. Build command `npm run build`, output dir `dist`
     (Vercel usually detects these automatically).
   - Add an environment variable `VITE_API_BASE_URL` set to your Render URL
     from step 2.
   - Deploy. Vercel gives you a URL like `https://cows-and-bulls.vercel.app`.
4. Go back to Render and set `CORS_ALLOWED_ORIGINS` to that Vercel URL
   (redeploy so it picks up the change), so the browser will actually allow
   the two to talk to each other.

That's it — both pieces are live, both free, and pushing to GitHub redeploys
both automatically from then on.
