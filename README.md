# FrameIQ

A small self-hosted web app for tracking a pool/snooker team's players, weekly match results, and stats — a public results page for anyone to view, plus an admin area for managing everything. Ships pre-loaded with demo data (fictional players/results) so you can see it working before entering your own.

## Making it your team's

1. Replace `public/logo-mark.png` with your own club/team logo (any image works; the app doesn't require a specific shape).
2. Swap the team name — search for **"Sample Team"** across `public/index.html` and `public/admin/index.html` (the `.brand-team` divs and page `<title>` tags) and replace it with your own team's name.
3. Optionally replace `public/favicon-32.png`, `favicon-192.png`, `favicon-512.png`, and `apple-touch-icon.png` with your own icon.
4. Once you're ready to start tracking your own season, delete `data/pool.db` (if it exists) and either run `npm run seed` again after editing `import/seed_data.json` with your own players/results, or just add everything through the admin UI from scratch (Players → Seasons → Roster → Match Entry).

## Running it

```
npm install
cp .env.example .env
```

Then edit `.env` and set your own `ADMIN_PASSWORD` (and ideally `SESSION_SECRET` — a random string; a command to generate one is in the file). Then:

```
npm start
```

Open http://localhost:4173 in your browser. Leave the terminal window open while you use the app — closing it stops the server. Data lives in `data/pool.db` (a SQLite file) and persists between runs.

## Public site vs admin

- **`/`** — public, no login required. Shows Performance and Match Results for whichever season is selected. This is what you'd share with players.
- **`/admin`** — everything else (Match Entry, Roster, Players, Seasons management), gated behind the password in `.env`. Log in at `/admin/login`.

If you put this online, make sure `.env` is never committed or exposed — `.gitignore` already excludes it. Sessions are stored in server memory, so restarting the server logs everyone out (fine for a small team tool; if you outgrow that, swap in a persistent session store).

## How the data model works

- **Players** are permanent records: name, original-member flag, joined/left dates, notes. A player exists once regardless of how many seasons they play.
- **Seasons** (e.g. "Summer 2026") each have their own **roster** — who's playing that season, their role (Captain / Vice-Captain / Member) and pick status (Regular / Sub). This can change season to season even though the player record itself doesn't.
- **Match Weeks** belong to a season. Each week has **entries** per player: singles/doubles won and lost, plus optional match details (opponent, date, home/away, score for/against, and a BYE flag for a scheduled bye week) — these are just for your own record-keeping and never factor into the Stats page.
- **Stats** (Appearances, Points, Win %, League Points, recent Form) are calculated live from match entries — nothing is stored twice, so they're always in sync with the data you enter.

Points = (singles won × 3) + (doubles won × 1). League Points = 1 per frame won, +1 bonus for winning the match (not awarded for a BYE week) — adjust the formulas in `src/server.js` if your league scores differently.

## Demo data

`import/seed_data.json` ships with two example seasons of realistic-looking (but entirely fictional) match data, used to populate the database the first time you run `npm run seed`. Feel free to edit this file before seeding, or just clear it out and build your own season up through the admin UI instead.

## Putting it online

This app is ready to deploy as-is (it's just a small Node/Express server), but a few things are worth knowing before you do:

- Whatever host you pick needs to run a persistent Node process (Render, Railway, Fly.io, a VPS, etc.) — not a static site host, since this has a real backend and database file.
- Set `ADMIN_PASSWORD` and `SESSION_SECRET` as environment variables on the host (the same names as in `.env`) rather than uploading your `.env` file.
- `data/pool.db` needs to live on persistent storage on whatever host you choose — some platforms wipe the filesystem on every deploy, which would lose your data. Check your host supports a persistent disk/volume, and point `DATA_DIR` at it.
- The app works fine over plain HTTP for local use; once it's on a public domain, put it behind HTTPS (most hosts do this for you automatically).
