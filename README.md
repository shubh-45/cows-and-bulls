# The Arcade

A small multi-game web app. Five browser games behind one hub, built with a
Spring Boot API and a React frontend.

Cows & Bulls is the only game backed by the API — its game logic lives server
side and the React client is a thin renderer. Every other game is entirely
client-side and works with the backend offline.

**Live:** [shubh-arcade.netlify.app](https://shubh-arcade.netlify.app) ·
**API:** [the-arcade-api.onrender.com](https://the-arcade-api.onrender.com)

## Games

| Game | Type | Backend |
|---|---|---|
| Cows & Bulls | Deduce a hidden 3-digit code | Spring Boot API |
| Wordle Clone | Five letters, six guesses, tile-colour feedback | Client-side |
| Reversi | 8×8 disc-flipping strategy, vs computer or 2-player | Client-side |
| Memory Match | Flip cards and find every pair | Client-side |
| Higher or Lower | Home in on a hidden number from 1–100 | Client-side |

## Project structure

```
cows-and-bulls/
├── backend/                     Spring Boot API (Java 17, Maven)
│   ├── Dockerfile               required: Render has no native Java runtime
│   └── src/main/java/com/petproject/cowsandbulls/
│       ├── controller/          REST endpoints
│       ├── service/             game rules, in-memory game store
│       ├── model/               Game + Attempt
│       └── dto/                 request/response records
└── frontend/                    React 18 + Vite
    └── src/
        ├── App.jsx              site shell: nav bar + route table
        ├── App.css              shared layout and components
        ├── index.css            global design tokens
        ├── pages/Home.jsx       the hub / game picker
        ├── data/gamesCatalog.js single source of truth for the hub grid
        └── games/
            ├── cows-and-bulls/  talks to the Spring Boot API
            ├── wordle/
            ├── reversi/
            ├── memory-match/
            └── high-low/
```

## Tech stack

- **Backend** — Java 17, Spring Boot 3.x, Maven. No database; games are held
  in an in-memory `ConcurrentHashMap`.
- **Frontend** — React 18, Vite, `react-router-dom`.
- **Hosting** — Render (backend, Docker) and Netlify (frontend, static).

## Running locally

### Backend

Requires Java 17+ and Maven.

```bash
cd backend
mvn spring-boot:run
```

Serves on `http://localhost:8080`. Quick check:

```bash
curl -X POST http://localhost:8080/api/games
```

### Frontend

Requires Node 18+.

```bash
cd frontend
npm install
npm run dev
```

Serves on `http://localhost:5173`. With no `VITE_API_BASE_URL` set it falls
back to `http://localhost:8080`, which matches the backend default — so the
two connect with no configuration.

Only Cows & Bulls needs the backend running. The other four games work
without it.

## Routing

The app uses `HashRouter`, so URLs look like `/#/games/wordle`. This is
deliberate: it needs no server-side rewrite rules, so refreshing mid-game
never 404s on static hosting. Switching to `BrowserRouter` would require
adding a catch-all rewrite on Netlify first.

## Shared design system

- `index.css` holds global tokens — `--bg`, `--panel`, `--text`, `--muted`,
  `--radius`, fonts, and the medal-tier colours.
- `App.css` holds shared layout and components reused by every game:
  `.page`, `.game-panel`, `.btn`, `.reward-banner`, `.history-section`.

Each game sets its own `--accent` on a `theme-<game>` wrapper class. Plain CSS
is not scoped per file here, so a game's own stylesheet must not redefine the
shared class names above — it will collide silently.

## Adding a new game

1. Create `src/games/<your-game>/` with a `<YourGame>.jsx` and its own `.css`.
2. Give the top-level wrapper a `theme-<your-game>` class and set `--accent`
   on it. `games/high-low/HighLow.css` is the minimal example.
3. Add a `<Route>` in `App.jsx`.
4. Add an entry to `data/gamesCatalog.js` with `status: 'live'` and a `path`.
   It appears on the hub automatically. Entries marked `'coming-soon'` render
   greyed out and are not clickable.

Reuse the shared classes from `App.css` rather than redefining them.

Games with a win condition reuse the shared reward-tier pattern — see
`.reward-banner` and the `.tier-*` classes in `App.css`.

## Reward tiers

Cows & Bulls maps attempt count to a tier in `GameService.rewardTierFor()`:

| Attempts | Tier |
|---|---|
| 1–5 | 🥇 Gold |
| 6–8 | 🥈 Silver |
| 9–12 | 🥉 Bronze |
| 13+ | 🎯 Participant |

The client-side games apply the same four tiers with thresholds suited to
each game.

## API

Base URL: `http://localhost:8080` locally.

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/games` | Start a game. Returns `gameId`. |
| `POST` | `/api/games/{gameId}/guesses` | Submit `{ "guess": "123" }`. |
| `GET` | `/api/games/{gameId}/history` | Attempts so far. |

The secret number is withheld from every response until the game is won.

Guesses must be 3 digits, with no repeats and no leading zero; anything else
returns a 400 with `{ "error": "..." }`.

## Deployment

Both services deploy automatically on push to `main`.

### Backend — Render

Render has no native Java runtime, so the service builds from
`backend/Dockerfile` (multi-stage: Maven build → JRE runtime). Any change to
the Java version or build process needs a matching Dockerfile change.

| Setting | Value |
|---|---|
| Service | `the-arcade-api` |
| Runtime | Docker |
| Root directory | `backend` |
| Environment | `CORS_ALLOWED_ORIGINS=https://shubh-arcade.netlify.app` |

The app reads `server.port=${PORT:8080}`, so it binds to the port Render
injects.

Free instances spin down after roughly 15 minutes of inactivity, so the first
request after an idle period takes 30–60 seconds. Because games are held in
memory, a spin-down also ends any game in progress.

### Frontend — Netlify

| Setting | Value |
|---|---|
| Site | `shubh-arcade` |
| Base directory | `frontend` |
| Build command | `npm run build` |
| Publish directory | `frontend/dist` |
| Environment | `VITE_API_BASE_URL=https://the-arcade-api.onrender.com` |

Changing an environment variable's value requires a manual "Trigger deploy"
on Netlify; Render picks env changes up on its own.
