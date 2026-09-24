# Roadmap

Ideas for future development. Not scheduled, not promises — just a running list so good ideas from planning conversations don't get lost. Pull requests welcome.

**Scope:** FrameIQ is a single-team performance tracker with one shared admin login. Multi-team league standings (tracking other teams' results to build a full league table) and multi-admin / role-based accounts are out of scope for this project, so pull requests for them won't be accepted. The team's own league points total stays as it is.

## Branding & theming

- [x] **Admin-configurable accent color** — a color picker in Settings, same pattern as the scoring-formula fields, so a team can make it "theirs" without touching CSS.
- [x] **Team name + logo from the UI** — currently "making it your team's" means find-replacing `Sample Team` across two HTML files and manually swapping `logo-mark.png`. Move both into Settings (name field + logo upload) so onboarding needs zero file edits.
- [x] **Light/dark theme toggle** — the app is dark-only today. A per-viewer toggle stored in `localStorage` (no DB or API change needed).

## Stats & data

- [x] **Head-to-head opponent records** — `match_weeks.opponent` is already free text; aggregate by it for a "record vs. Kingsway A: 3W 1L" view. Pairs naturally with player profiles.
- [ ] **Form against head-to-head opponents** — the same W/L "form" chips used on player rows, but for the team's last few results against each opponent, added as a column in the Head-to-Head table.
- [ ] **Record frame sets** — today a match stores only the overall score plus a won/lost result per player for singles and doubles. Add the ability to record the individual frames (or sets of frames) that make up a match, so results can be broken down frame by frame rather than as a single win/loss.
- [x] **Season awards / milestones** — season awards, feats and team awards (published by the admin at season end), plus live career milestones and profile badges, all derived from existing match data.
- [ ] **CSV export per season** — separate from the full JSON backup (which is for migrating hosts); this is for dropping a season into a spreadsheet or printing for a clubhouse noticeboard.

## Quality of life

- [ ] **ICS calendar feed of fixtures** — a `/calendar.ics` route built from `match_date`/`opponent`/`venue` that players can subscribe to.
- [ ] **PWA manifest** — so "Add to Home Screen" gives a proper app icon; this is a phone-first tool for most players.
- [ ] **Discord/Slack webhook on match save** — auto-post "Week 6: Won 6-3 vs The Sharpshooters" when an admin records a result, since most teams already coordinate in a group chat.

---

*Captured 2026-09-17, after Phase 3 (configurable scoring settings + player profile pages) shipped, as FrameIQ moved from "our team's tool" to a public template.*
