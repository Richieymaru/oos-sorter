# OOS Sorter — settings page (control panel)

**Date:** 2026-07-24
**Status:** design, awaiting review
**Builds on:** the working engine + three features (sort / notify / draft) and
their spec, `2026-07-24-oos-sorter-toggle-features-design.md`.

---

## Goal

Give the owner a simple web page to turn the three features on and off without
editing files, plus see status and trigger the sold-out report on demand.

The page is a **control panel**, not a rewrite. The engine we already built and
tested does all the real work, unchanged. The page only reads and writes a
settings metafield that the engine consults.

---

## Decisions locked in during brainstorming

- **Standalone page, not embedded in Shopify admin.** A bookmarked URL, not the
  admin chrome. (Embedded app was considered and deferred — far more work.)
- **Hosted on Vercel**, serverless (wakes on request, no 24/7 server to run).
- **Three toggles, all OFF by default.** Nothing happens after deploy until the
  owner enables something.
- **Also on the page:** an "Email me the sold-out list now" button, and a
  read-only status line (current sold-out count + last run time).
- **Engine stays on GitHub Actions**, now every **5 minutes**. Vercel's free
  cron is daily-only, so the frequent runs stay on GitHub.
- **Repository is public** so 5-minute GitHub Actions runs are free (unlimited
  minutes for public repos). Identifying details are scrubbed first; no secrets
  are ever in the code.

## Non-goals

- Not embedded in the Shopify admin (no App Bridge / Polaris / OAuth install).
- Not real-time. Reaction is bounded by the 5-minute check interval.
- No multi-user accounts — one shared password.
- No per-collection settings — the toggles are global, as today.

---

## Architecture

```
   ┌──────────────────────────┐        writes        ┌───────────────────────┐
   │  Settings page (Vercel)  │  ─────────────────▶  │  Shopify metafield    │
   │  - 3 toggles + Save      │                       │  oos_sort.settings    │
   │  - "Email me now" button │  ◀─────────────────   │  {sort,notify,draft}  │
   │  - status line           │        reads          └───────────────────────┘
   └──────────────────────────┘                                  ▲  reads
              (password-gated)                                    │
                                                     ┌────────────┴───────────┐
                                                     │  Engine (GitHub Actions │
                                                     │  cron, every 5 min)     │
                                                     │  sort / notify / draft  │
                                                     │  writes lastRun + count │
                                                     └─────────────────────────┘
```

Three independent pieces sharing two metafields. The page and the engine never
talk to each other directly — they coordinate only through `oos_sort.settings`
(the toggles) and `oos_sort.state` (status + feature memory).

---

## Settings storage

New shop metafield, alongside the existing `oos_sort.state`:

| Key | Owner | Type | Shape |
|---|---|---|---|
| `oos_sort.settings` | shop | json | `{ "sort": false, "notify": false, "draft": false }` |

Absent metafield ⇒ all three treated as `false`. The page writes it; the engine
reads it.

`oos_sort.state` gains two status fields (already a JSON blob): `lastRun`
(ISO timestamp) and reuse of `soldOut.length` for the current count. The engine
writes `lastRun` on **every** run, regardless of which features are on, so the
status line is always fresh.

---

## The page (Vercel serverless functions)

All under `/api`, all password-gated (see Security). ESM Node functions that
import the existing modules — very little new logic.

| Endpoint | Method | Does |
|---|---|---|
| `/` (or `/api/index`) | GET | Read `oos_sort.settings` + `oos_sort.state`; render the HTML page: 3 checkboxes reflecting current state, Save button, "Email me now" button, status line. |
| `/api/save` | POST | Validate password; write the 3 booleans to `oos_sort.settings`. Redirect back to the page. |
| `/api/report` | POST | Validate password; gather the current sold-out list and email it (reuses `report.mjs` logic + `notify.mjs`). Return a small "sent ✓" confirmation. |

The page HTML is server-rendered (no framework, no build step) — a small inline
form and two buttons. Keeps the footprint tiny and matches the project's
no-framework ethos.

Shared helpers reused as-is: `shopify.mjs` (auth, gql), `state.mjs`,
`stock.mjs`, `notify.mjs`, and `findCollection`/`fetchProducts` from
`sort-oos.mjs`. New code is mostly HTML rendering + the auth check + a
`settings.mjs` load/save (mirrors `state.mjs`).

---

## Engine changes (small, in `sort-oos.mjs`)

1. **Read toggles from the metafield.** Load `oos_sort.settings`; use
   `settings.sort/notify/draft` (each defaulting to `false`) as the feature
   flags. An explicitly-set `FEATURE_*` env var still overrides — handy for
   local dry-run testing — but the metafield is the source of truth in
   production.
2. **Always stamp status.** Write `lastRun` (and the current sold-out count via
   `soldOut`) to `oos_sort.state` every run, even when all features are off, so
   the page's status line is accurate.
3. **Nothing else changes.** Sort/notify/draft behaviour is exactly what we
   already built and verified.

Cron interval moves from `*/15` to `*/5` in the workflow.

---

## Security

- **One password gates the page**, held in a Vercel env var (`PANEL_PASSWORD`).
  Implemented as HTTP Basic Auth (browser shows a login prompt) — minimal code,
  fine for a single-owner internal tool. Every endpoint checks it.
- **All credentials live only in secret stores**, never in code or the browser:
  Shopify (`CLIENT_ID`/`CLIENT_SECRET`) and Gmail (`GMAIL_*`) go in Vercel env
  vars for the page, and remain in GitHub Secrets for the engine.
- **Public repo is safe** because secrets are never committed (`.env` is
  gitignored; `.env.example` holds placeholders). Before going public we scrub
  identifying-but-not-secret details from committed docs (see below).

---

## Cost model (explicit — the owner asked)

| Piece | Cost | Notes |
|---|---|---|
| GitHub Actions engine, 5-min | **$0** | Public repo ⇒ unlimited free minutes. |
| Vercel settings page | **$0** | Hobby free tier; non-commercial. Real client stores later may need Vercel Pro (~$20/mo). |
| Gmail | **$0** | App Password, already working. |

Private repo at 5-min would exceed GitHub's free 2,000 min/month (~$50/mo),
which is why the repo is public.

---

## Going-public prep (scrub list)

Before the first public commit, replace real values with placeholders in
committed files (real values stay only in the gitignored `.env`):

- store domain `*.myshopify.com`, `CLIENT_ID`
- the recipient email address
- anywhere these appear: `CLAUDE.md`, `README.md`, the two spec docs

Confirm `.gitignore` still covers `.env` and `node_modules/` (it does).

---

## Testing

- `oos_sort.settings` load/save: metafield round-trip test, like `state.mjs` has.
- Page rendering + settings parsing: pure unit tests (toggle state → HTML,
  form body → settings object).
- Auth gate: request without/with the right password → 401 / 200.
- "Email me now": reuses already-verified report path; smoke-tested with
  `vercel dev` locally before deploy.
- Engine change: dry-run confirming it reads the metafield toggles and that
  `FEATURE_*` env still overrides for local testing.

---

## Deliverables (planned)

| File | Change |
|---|---|
| `api/index.mjs` | **new** — render the settings page (GET) |
| `api/save.mjs` | **new** — persist toggles (POST) |
| `api/report.mjs` | **new** — send the sold-out report now (POST) |
| `api/_auth.mjs` | **new** — shared Basic Auth check |
| `settings.mjs` | **new** — load/save `oos_sort.settings` |
| `sort-oos.mjs` | read toggles from metafield; always stamp `lastRun` |
| `github-actions-workflow.yml` | cron `*/15` → `*/5` |
| `vercel.json` | **new** — route `/` to the page, Node runtime |
| `CLAUDE.md` / `README.md` / specs | scrub identifying details for public repo |
| `*.test.mjs` | settings round-trip + page-render unit tests |

## Owner setup tasks (outside the code)

1. Create a free Vercel account; connect the (public) GitHub repo.
2. Set Vercel env vars: `SHOP_DOMAIN`, `CLIENT_ID`, `CLIENT_SECRET`,
   `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `NOTIFY_EMAIL`, `PANEL_PASSWORD`.
3. Add the same secrets to GitHub (for the engine) if not already there.
4. Make the repo public (after the scrub).
5. Bookmark the Vercel URL.
