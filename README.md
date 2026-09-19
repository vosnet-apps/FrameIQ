# FrameIQ

A small self-hosted web app for tracking a pool/snooker team's players, weekly match results, and stats — a public results page for anyone to view, plus an admin area for managing everything. Ships pre-loaded with demo data (fictional players/results) so you can see it working before entering your own.

## Admin screenshots

The public results page is what you'd share with your league — everything below is the admin side you manage it from, gated behind your own password.

**Team Stats overview** — live win rate, points leader, league points, and a full performance table with per-player form.
![Admin stats overview](docs/screenshots/admin-stats.png)

**Match Entry** — log each week's date, venue, opponent, score and BYE weeks in a couple of clicks.
![Admin match entry](docs/screenshots/admin-match-entry.png)

**Roster** — set who's playing each season, their role (Captain/Vice-Captain/Member) and pick status (Regular/Sub).
![Admin roster](docs/screenshots/admin-roster.png)

**Players** — the permanent player list: original-member flag, joined/left dates, notes.
![Admin players](docs/screenshots/admin-players.png)

**Seasons & backup** — manage seasons and export/import the full dataset as JSON.
![Admin seasons](docs/screenshots/admin-seasons.png)

Admin access sits behind a password screen:
![Admin login](docs/screenshots/admin-login.png)

## Making it your team's

1. Log in to `/admin` and open **Settings → Branding** to set your team name, upload your logo (PNG, JPEG, WebP or GIF, up to 1 MB — any shape works) and pick an accent color. Click **Save Settings**; it applies everywhere immediately, no code edits or restart needed.
2. Optionally replace `public/favicon-32.png`, `favicon-192.png`, `favicon-512.png`, and `apple-touch-icon.png` with your own icon (browser-tab icons aren't part of Settings yet).
3. Once you're ready to start tracking your own season, delete `data/pool.db` (if it exists) and either run `npm run seed` again after editing `import/seed_data.json` with your own players/results, or just add everything through the admin UI from scratch (Players → Seasons → Roster → Match Entry).

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
- **`/admin`** — everything else (Match Entry, Roster, Players, Seasons management, Settings), gated behind the password in `.env`. Log in at `/admin/login`.

If you put this online, make sure `.env` is never committed or exposed — `.gitignore` already excludes it. Sessions are stored in server memory, so restarting the server logs everyone out (fine for a small team tool; if you outgrow that, swap in a persistent session store).

## How the data model works

- **Players** are permanent records: name, original-member flag, joined/left dates, notes. A player exists once regardless of how many seasons they play.
- **Seasons** (e.g. "Summer 2026") each have their own **roster** — who's playing that season, their role (Captain / Vice-Captain / Member) and pick status (Regular / Sub). This can change season to season even though the player record itself doesn't.
- **Match Weeks** belong to a season. Each week has **entries** per player: singles/doubles won and lost, plus optional match details (opponent, date, home/away, score for/against, and a BYE flag for a scheduled bye week) — these are just for your own record-keeping and never factor into the Stats page.
- **Stats** (Appearances, Points, Win %, League Points, recent Form) are calculated live from match entries — nothing is stored twice, so they're always in sync with the data you enter.

Points = (singles won × points-per-singles-win) + (doubles won × points-per-doubles-win). League Points = (frames won × points-per-frame-won) + a bonus for winning the match — a BYE week still earns frame points for its recorded score, but never the win bonus. All four rates default to 3 / 1 / 1 / 1 and can be changed from **Settings** in the admin area if your league scores differently, with no code change needed.

## Demo data

`import/seed_data.json` ships with two example seasons of realistic-looking (but entirely fictional) match data, used to populate the database the first time you run `npm run seed`. Feel free to edit this file before seeding, or just clear it out and build your own season up through the admin UI instead.

## Putting it online

This app is ready to deploy as-is (it's just a small Node/Express server), but a few things are worth knowing before you do:

- Whatever host you pick needs to run a persistent Node process (Render, Railway, Fly.io, a VPS, etc.) — not a static site host, since this has a real backend and database file.
- Set `ADMIN_PASSWORD` and `SESSION_SECRET` as environment variables on the host (the same names as in `.env`) rather than uploading your `.env` file.
- `data/pool.db` needs to live on persistent storage on whatever host you choose — some platforms wipe the filesystem on every deploy, which would lose your data. Check your host supports a persistent disk/volume, and point `DATA_DIR` at it.
- The app works fine over plain HTTP for local use; once it's on a public domain, put it behind HTTPS (most hosts do this for you automatically).
