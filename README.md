# Thrones Monopoly

A real-time, browser-based multiplayer Monopoly reskinned as a game of thrones
over Westeros. Up to 8 players join a room via a 4-character code or a direct
invite link, and play out a fully server-authoritative game of buying,
building, and bankrupting each other across 40 tiles of the Seven Kingdoms.

Built as a portfolio piece to demonstrate real-time state synchronization,
authoritative server design, and resilient handling of an inherently flaky
transport (WebSockets over the open internet).

## Features

- **2–8 player rooms** via short shareable codes (`?room=ABCD` deep links supported)
- **Server-authoritative game state** — the client never decides outcomes; it only sends intents and renders whatever the server broadcasts
- **Full Monopoly rule set**: dice rolls with a three-doubles jail rule, rent (including monopoly bonus, even-build houses/hotels, scaling railroad and dice-multiplied utility rent), Chance ("Valar Morghulis") and Community Chest ("A Debt Must Be Paid") decks, mortgaging, and bankruptcy with asset liquidation
- **Graceful disconnect handling** — a dropped player gets a 30-second reconnect grace period (their seat and holdings are preserved); if it was their turn, the game moves on without them so the room never stalls
- **Live chat + event log** so players can coordinate and follow the game's history
- **Zero build step** on the client — plain ES modules and Tailwind via CDN, deployable straight to GitHub Pages

## Architecture

```
┌─────────────────────┐        WebSocket (Socket.io)        ┌──────────────────────┐
│  Client (GitHub      │ ───────────────────────────────────▶│  Server (Render /     │
│  Pages)               │◀─────────────────────────────────── │  Railway)             │
│  index.html + app.js  │        roomUpdate / chatMessage      │  server.js            │
└─────────────────────┘                                       └──────────────────────┘
```

- **Client** renders the board, roster, dice, and chat purely from the most
  recent `roomUpdate` payload. It has no game logic of its own — a player
  clicking "Buy" just emits `buyProperty`; the server decides whether that's
  legal and broadcasts the result to everyone in the room.
- **Server** holds all room state in memory (`Map<roomCode, Room>`), keyed by
  room code. Each `Room` tracks players, turn order, ownership, buildings,
  mortgages, and an event log. Every mutating socket event revalidates that
  the request came from the player whose turn it currently is before
  touching state.
- **Rent is computed from a formula**, not looked up in 22 hand-written
  tables: `rent = round(price × 0.1) × houseMultiplier`, with a monopoly
  doubling bonus, classic railroad doubling (25/50/100/200), and dice-scaled
  utility rent (×4 for one, ×10 for both). This keeps the board data compact
  and the rent logic auditable in one place.

## Project structure

```
thrones-monopoly/
├── package.json
├── server.js
├── .gitignore
└── public/
    ├── index.html
    └── app.js
```

## Running locally

**Prerequisites:** Node.js 18+ (npm comes bundled with it)

1. Open this folder in VS Code, then open a terminal (`` Ctrl+` ``) and install dependencies:
   ```bash
   npm install
   ```

2. Start the backend:
   ```bash
   npm start
   ```
   The server listens on `http://localhost:3001` by default and also serves
   `public/` directly, so you can open `http://localhost:3001` in a browser
   and play entirely from one process with no extra setup.

3. Open the page in two or more browser tabs (or on two devices on the same
   network) to test multiplayer locally before deploying.

## Deployment

### Backend → Render

1. Push this folder to a GitHub repo (see "Pushing to GitHub" below).
2. Go to [render.com](https://render.com) → **New** → **Web Service** → connect
   the repo.
3. Build command: `npm install`. Start command: `npm start`.
4. Add an environment variable:
   - `CLIENT_ORIGINS` = `https://oSaio.github.io`
5. Deploy. Render gives you a URL like `https://thrones-monopoly.onrender.com`
   — copy it, you'll need it in the next step.

> Free tiers on Render spin down after inactivity; the first roll of the
> dice after a cold start may take a few seconds while the server wakes up.

### Frontend → GitHub Pages

1. In `public/app.js`, find this line near the top:
   ```js
   : 'https://YOUR-BACKEND-DOMAIN.onrender.com';
   ```
   Replace `YOUR-BACKEND-DOMAIN.onrender.com` with the actual Render URL
   from the previous step, then save and commit/push the change.
2. In your GitHub repo → **Settings → Pages**, set source to the `public/`
   folder on the `main` branch (or root, if you restructure).
3. Your game will be live at `https://oSaio.github.io/thrones-monopoly/`.
4. Share invite links as `https://oSaio.github.io/thrones-monopoly/?room=ABCD`.

## Known limitations & possible extensions

- **No property auctions** — declining a purchase leaves the tile unowned
  rather than opening it to a live auction.
- **No trading between players** — a natural follow-up.
- **In-memory state only** — a server restart clears all rooms. A production
  version would persist to Redis so a redeploy doesn't end in-progress games.
- **Single process** — fine for a portfolio demo; horizontal scaling would
  need a shared adapter (e.g. `@socket.io/redis-adapter`).

## Tech stack

| Layer     | Technology                                  |
|-----------|----------------------------------------------|
| Frontend  | HTML5, Tailwind CSS (CDN), vanilla JS (ES modules) |
| Real-time | Socket.io (client + server)                  |
| Backend   | Node.js, Express                             |
| Hosting   | GitHub Pages (client) + Render (server)      |
