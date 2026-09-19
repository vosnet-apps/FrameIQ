# Contributing to FrameIQ

Thanks for wanting to help. This page explains how to contribute and what we expect.

## Before you start

1. **Open an issue first** for anything bigger than a small fix, so we can agree on the approach before you spend time on it. The [ROADMAP](ROADMAP.md) lists what is already planned.
2. **Agree to the [Contributor License Agreement](CLA.md).** FrameIQ is released under [AGPL-3.0](LICENSE). The CLA lets the maintainer accept your work and use it in FrameIQ and in other products. You keep ownership of your code. We can't merge a pull request until you have agreed.

## Running it locally

```bash
npm install
# first create a .env file containing ADMIN_PASSWORD (see the README)
npm start
```

See the [README](README.md) for details. `npm run seed` loads sample data.

## Security rules for all code

FrameIQ handles data typed in by strangers. **Treat everything a user enters, or a file they upload, as untrusted.** Pull requests that break these rules will not be merged.

- **Database:** use parameterised queries (`?` placeholders) only. Never build SQL by joining strings. Column and table names must come from a fixed allow-list in the code, never from user input.
- **Output:** every value a user can influence must be escaped with `escapeHtml()` before it goes into `innerHTML`, or set with `textContent`. Don't add inline `<script>`, inline event handlers or `javascript:` URLs; the Content-Security-Policy blocks them.
- **Input:** check type, length and allowed values on the server. Client-side checks are for convenience only.
- **Auth:** keep admin routes behind the existing admin check. Don't weaken login throttling, session or cookie settings.
- **Dependencies:** don't add a new dependency without discussing it in an issue first. Every dependency is extra attack surface.
- **Secrets:** never commit `.env`, passwords, keys or real player data.

**Found a vulnerability?** Don't open a public issue. Contact the maintainer privately (see `SECURITY.md` once published, or use GitHub's private vulnerability reporting on the repo).

## Making a pull request

- Keep each pull request to one change, with a clear description of what and why.
- Match the style of the surrounding code (plain JavaScript, no build step, `node:sqlite`).
- Run the app and try your change in the browser, including the admin pages if you touched them, and try some hostile input (for example `<img src=x onerror=alert(1)>` as a player name).
- Update the README or ROADMAP if you change behaviour.
- Don't include code you didn't write unless you say where it came from and its licence (see the CLA).
- Say in the pull request that you agree to the CLA (see [CLA.md](CLA.md)) if you haven't already.

## Behaviour

Be kind and constructive. Harassment or abuse gets you removed from the project.
