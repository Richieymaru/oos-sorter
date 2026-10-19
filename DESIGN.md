# OOS Sorter — Visual Restyle (DESIGN.md)

**Goal:** lift the look of the GBU Store Ops app to the calm, confident polish of
`reference.png` (the SocialPulse analytics dashboard). **Restyle only.**

**Hard constraints (from the brief):**
- No features, pages, components, fields, buttons, data, or content added, removed,
  renamed, or reordered.
- No content or widgets copied from the reference. It is a *style guide*, not a layout.
- Layout structure, grids, and behaviour stay exactly as they are.
- **Our app is not Polaris** — it has its own custom CSS design system in `ui.mjs`
  (string-rendered, no framework). So "apply within Polaris" becomes *apply within
  our CSS tokens and class rules*. We change only CSS variables and styling rules;
  **class names stay stable** so every page (Dashboard, Collections, Waitlists,
  Notified, Funnels, Settings, Email preview) restyles for free.
- We keep our **top nav** (no sidebar). The reference's dark sidebar is a layout
  choice we do **not** copy.

---

## 1. Why the reference reads as "clean" (the techniques to borrow)

1. **Whitespace does the separating, not lines.** Cards sit on a light grey field
   with real gaps between them and generous internal padding; borders are almost
   invisible. Grouping comes from space, not boxes-within-boxes.
2. **Colour restraint.** One green. It appears only where it means something — the
   active tab, the data in a chart, a positive delta — never as background
   decoration. Everything else is white, grey, and near-black.
3. **A steep type hierarchy.** KPI values are very large and bold; their labels are
   small, muted, and quiet. The eye lands on the number first, every time.
4. **Soft, consistent surfaces.** One large corner radius, one soft shadow, flat
   white fills. Nothing competes.
5. **Charts styled like the UI, not like a chart library.** Area fills are a single
   green fading to transparent; the donut and bars are tints of the same green; grid
   lines are faint; one value is emphasised. No rainbow categorical palettes.
6. **Alignment & rhythm.** Everything aligns to a small spacing grid; numbers use
   tabular figures so columns line up.

Our app already does most of this. The restyle is a **refinement pass**: soften the
card borders, open up the spacing, tighten the accent to data-only, and sharpen the
number-vs-label hierarchy — not a new design.

---

## 2. Design tokens

### Colour

**One accent — emerald** (the app's established identity; it also matches the
reference's green family). Used sparingly: active nav, primary button, positive
deltas, chart data, focus ring. A 5-step tint ramp replaces today's single
`--accent-wash`.

| Token | Light | Role |
|---|---|---|
| `--accent-50` | `#eef8f3` | wash / active-tab fill / soft chip bg |
| `--accent-100` | `#cfeede` | hover fill, chart area fade, light cells |
| `--accent-300` | `#5fcfa1` | mid chart tint, secondary data |
| `--accent` (500) | `#0fa373` | the accent: button, active, deltas, emphasis |
| `--accent-700` | `#0a6549` | accent text on light (`--accent-ink`) |

> Note: the reference's green is a brighter lime. We stay emerald so it reads as
> *this app* and stays legible as text — but I can shift one notch brighter
> (`#12b37e`) for more energy if you want. Say the word.

**Neutrals** (light; dark mode mirrors each token — same names, redefined):

| Token | Light | Role |
|---|---|---|
| `--bg` | `#f4f6f8` | page field |
| `--surface` | `#ffffff` | cards |
| `--surface-2` | `#fafbfc` | subtle inset / header tint |
| `--ink` | `#0e141c` | primary text, KPI values |
| `--muted` | `#5b6572` | labels, secondary text |
| `--faint` | `#8d97a3` | meta, captions, table head |
| `--line` | `#eceff3` | hairline separators (lighter than today) |
| `--line-2` | `#f1f4f7` | inner row dividers (near-invisible) |
| `--hover` | `#f3f5f8` | row / ghost hover |

**Semantic** (kept, lightly aligned): `--pos` = accent, `--warn` `#b5761b`,
`--danger` `#c5384b`, `--info` `#3667e0`, each with a `-wash`. Semantic colours are
for status only, never for layout accent.

### Typography

Keep **Hanken Grotesk** (one family, already loaded). Hierarchy by size + weight +
colour — not by extra labels or all-caps. A clear scale:

| Role | Size | Weight | Colour | Notes |
|---|---|---|---|---|
| Page title (`.pagehead h1`) | 26px | 700 | ink | `letter-spacing:-.03em` |
| KPI value (`.statval`) | 36px | 740 | ink | tabular-nums, `-.04em` |
| Card / section title | 15px | 640 | ink | sentence case |
| KPI label (`.statlabel`) | 13px | 540 | muted | small, quiet |
| Body / rows | 13.5px | 450 | ink | line-height 1.5 |
| Meta / caption (`.faint`) | 12px | 500 | faint | |

Rules: sentence case everywhere; **no tracked-out ALL-CAPS eyebrows**; no decorative
labels above content; numbers always tabular. Body/measure capped ~60ch (already).

### Spacing (4 / 8 scale)

`4, 8, 12, 16, 20, 24, 32`. Targets, slightly more generous than today:
- Card padding: **24px** (from 20–22).
- Grid gap between cards: **16px**.
- Page padding: 32px top, 24px sides.
- Section-to-section: 24–32px.
- Inside a card, element gaps: 8 / 12 / 16.

### Surfaces (radius, shadow, borders)

- `--radius: 16px`, `--radius-sm: 12px`, pills `999px`.
- **Shadow:** one soft token for cards — `--shadow-sm` (very low, for lift only).
  `--shadow-lg` reserved for hover/menus. No heavy shadows.
- **Borders:** cards lose the visible border — rely on shadow + whitespace. Keep a
  **1px `--line` only where it does real work** (table/row dividers, card headers,
  toolbar bottoms). This is the single biggest "cleaner" lever.
- Drop the gradient tint on `.card-h` (flat, quiet header).

---

## 3. Component rules (restyle, same markup)

- **Stat card (`.stat`):** flat white, no border, soft shadow; value 36/740, label
  13/540 muted; keep the small tinted icon chip but calm it (accent-50 bg,
  accent-700 glyph). Keep the hover lift but make it subtler (translateY -2px).
- **Card (`.card`) / card header (`.card-h`):** borderless card; header is flat,
  15/640 title, hairline bottom only.
- **Nav tabs:** active = `--accent-50` fill + `--accent-700` text (quieter than the
  current inset ring). Idle = muted; hover = `--hover`.
- **Table:** head 12/600 faint, generous 14–16px cell padding, `--line-2` row
  dividers, hover `--hover`, tabular nums for number columns.
- **Badges / tags / status chips:** keep the wash+ink pattern; use the accent wash
  only for positive, neutrals for the rest. Slightly larger radius.
- **Buttons:** primary = solid accent (flatten the gradient to a single `--accent`,
  with a quiet shadow); ghost = white + hairline. Keep the focus ring token.
- **Toggles, callout, feed:** inherit the new tokens; no structural change.
- **Charts (Funnels page):** fills/strokes become accent + its tints
  (`--accent`, `--accent-300`, `--accent-100`), area gradient fading to transparent,
  faint grid; one emphasised point. No new chart types.

---

## 4. How this applies in code (Step 2 scope)

Everything above lands in **one place first**: the `CSS` token block and rules in
`ui.mjs` (`--accent*`, neutrals, radius, shadow, `.card`, `.stat`, `.card-h`,
`nav.tabs`, `table`, `button`, badges). Because the pages share these classes, they
restyle together. A few per-page inline styles (Waitlists/Notified/Settings cards,
Funnels chart colours) get swept to match the tokens. **No markup, grid, copy, or
behaviour changes.**

---

## 5. What I will NOT touch

Features, routes, page content, grid/layout structure, data, button actions, form
fields, the top-nav structure, email templates. Only colours, spacing, typography,
radius, shadows, borders.

---

## 6. Step 2 plan (after you approve)

Apply tokens in `ui.mjs`, then review **one screen at a time** — Dashboard →
Collections → Waitlists → Notified → Funnels → Settings — taking a before/after
screenshot of each and confirming only styling changed. Fix spacing/weight/colour
gaps against the reference, up to a few passes per screen, then show you the finals.
