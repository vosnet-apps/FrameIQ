# Roadmap

Ideas for future development. Not scheduled, not promises — just a running list so good ideas from planning conversations don't get lost. Pull requests welcome.

## Branding & theming

- [x] **Admin-configurable accent color** — a color picker in Settings, same pattern as the scoring-formula fields, so a team can make it "theirs" without touching CSS.
- [ ] **Team name + logo from the UI** — currently "making it your team's" means find-replacing `Sample Team` across two HTML files and manually swapping `logo-mark.png`. Move both into Settings (name field + logo upload) so onboarding needs zero file edits.
- [ ] **Light/dark theme toggle** — the app is dark-only today. A per-viewer toggle stored in `localStorage` (no DB or API change needed).

## Stats & data

- [ ] **Head-to-head opponent records** — `match_weeks.opponent` is already free text; aggregate by it for a "record vs. Kingsway A: 3W 1L" view. Pairs naturally with player profiles.
- [ ] **Season awards / milestones** — Player of the Season, longest win streak, most improved, milestone frames (e.g. 100th win) — all derivable from existing `match_entries`, no schema change.
- [ ] **Standings / full league table** — track other teams' results too, not just this team's, so the app can show a real league table instead of just one team's record.
- [ ] **CSV export per season** — separate from the full JSON backup (which is for migrating hosts); this is for dropping a season into a spreadsheet or printing for a clubhouse noticeboard.

## Quality of life

- [ ] **ICS calendar feed of fixtures** — a `/calendar.ics` route built from `match_date`/`opponent`/`venue` that players can subscribe to.
- [ ] **PWA manifest** — so "Add to Home Screen" gives a proper app icon; this is a phone-first tool for most players.
- [ ] **Discord/Slack webhook on match save** — auto-post "Week 6: Won 6-3 vs The Sharpshooters" when an admin records a result, since most teams already coordinate in a group chat.

## Bigger / longer-term

- [ ] **Multi-admin / role-based permissions** — currently one shared `ADMIN_PASSWORD` for everything. A lighter-weight option might be per-captain accounts with scoped permissions (e.g. match entry only vs. full admin).

---

*Captured 2026-09-17, after Phase 3 (configurable scoring settings + player profile pages) shipped, as FrameIQ moved from "our team's tool" to a public template.*
