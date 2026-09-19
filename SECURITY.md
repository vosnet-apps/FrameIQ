# Security Policy

FrameIQ handles data typed in by strangers, so we take security reports seriously. Thank you for helping keep it safe.

## Reporting a vulnerability

**Please do not open a public issue or pull request for a security problem.**

Report it privately using **GitHub private vulnerability reporting**: go to the repository's **Security** tab and choose **Report a vulnerability**.

Please include:

- What the problem is and where it is (page, endpoint, file).
- Steps to reproduce, or a proof of concept.
- What an attacker could do with it.
- The version or commit you tested, and how you ran it.

Please don't include real personal data, and don't share details publicly until we have had a chance to fix the problem.

## What to expect

FrameIQ is maintained by a small team, so these are targets, not guarantees:

- **Acknowledgement** within 5 working days.
- **An initial assessment** (confirmed, not confirmed, or need more information) within 10 working days.
- **A fix or mitigation** for confirmed issues as quickly as their severity allows, with critical issues first.
- **Credit** in the release notes if you'd like it, once the fix is released.

There is no bug bounty.

## Supported versions

Only the latest commit on the `main` branch is supported. Fixes are not back-ported. If you self-host FrameIQ, update to the latest version to receive security fixes.

## Scope

In scope:

- The FrameIQ application code in this repository (server, database access, admin and public pages, CSV/data import).
- Weaknesses such as SQL injection, cross-site scripting (XSS), authentication or session bypass, cross-site request forgery, insecure defaults, information disclosure and unsafe file handling.

Out of scope:

- Problems with how you host it: your server, operating system, reverse proxy, TLS certificate or network. See "Hardening a self-hosted install" below.
- Weak admin passwords chosen by the person running the site.
- Attacks that need the admin password, physical access to the server, or control of the database file.
- Denial-of-service attacks, and automated scanner output with no demonstrated impact.
- Social engineering of the maintainers or users.
- Vulnerabilities in third-party dependencies with no demonstrated effect on FrameIQ. Report those to the dependency's own maintainers.
- Other deployments of FrameIQ that you don't own (for example, a team's live site). Report the problem to us and we'll pass it on. **Don't test against sites you don't own or have permission to test.**

## Safe harbour

If you act in good faith, we will not take legal action against you for research that follows this policy. In particular, you should:

- Test only against your own installation.
- Avoid accessing, changing or deleting data that isn't yours.
- Stop and report as soon as you confirm a problem, and don't exploit it further.
- Not degrade the service for anyone else.

## What FrameIQ already does

For context when testing, FrameIQ currently includes:

- Parameterised SQL queries, and an allow-list for data-import columns.
- Output escaping for user-entered text, and no inline scripts.
- A Content-Security-Policy and other security headers.
- Admin login with constant-time password comparison, a lockout after repeated failures, and a new session on login.
- Sessions stored server-side, with `HttpOnly`, `SameSite=Lax` and (over HTTPS) `Secure` cookies.
- Rejection of cross-origin write requests.

Known limitations, so you don't need to report them as new findings:

- The Content-Security-Policy still allows inline styles.
- Login lockout is per IP address and is held in memory (it resets when the server restarts).
- Cross-site request forgery protection relies on `SameSite` cookies and an `Origin` check rather than per-request tokens.
- There is a single shared admin password: no multi-factor authentication, per-user accounts or audit log.
- No independent penetration test has been carried out.

## Hardening a self-hosted install

- Set a long, unique `ADMIN_PASSWORD`.
- Serve the site only over HTTPS.
- Never commit or expose your `.env` file or the `data/` folder.
- Keep Node.js and dependencies up to date (`npm audit`, `npm update`).
- Back up the database file regularly, and keep backups private.
- Limit who can log in to the server that hosts it.

## Disclosure

Once a fix is released, we may publish an advisory describing the issue and crediting the reporter (with your permission). Please give us a reasonable time to fix a problem before you disclose it, normally up to 90 days.
