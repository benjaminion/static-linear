# AGENTS.md

## Purpose

This is an Astro 7 static site that turns one Linear initiative, its projects, issues,
sub-issues, milestones, comments, updates, and dependencies into a public website.
Linear is queried only during an explicit CLI sync/build; the generated site has no
runtime API access and must never receive the Linear API key.

## Product constraints

- Keep refreshes on demand. Do not add cron jobs, local schedulers, polling, or a
  server-side runtime. `npx astro build` is the normal refresh-and-build command.
- Preserve the compact presentation and the existing colour scheme unless asked.
- The top navigation intentionally has no product name or logo placeholder.
- Project pages intentionally omit the Issues/Completed/Milestones metric row.
- The homepage “About this initiative” section uses the initiative body from the
  public snapshot (`initiative.descriptionHtml`), rendered from Linear Markdown
  with the usual sanitization and starred-link stripping. Do not reintroduce a
  local override file for that section unless the user explicitly asks.

## Data flow and privacy

- GraphQL operations live in `src/lib/linear/queries.ts`; pagination and extraction
  live in `src/lib/linear/sync.ts`.
- `src/lib/linear/normalize.ts` converts API responses into the public snapshot
  validated by `src/lib/schema.ts` and cached at `.cache/linear-public.json`.
- Pages must consume the validated public snapshot, not raw Linear responses.
- Keep `LINEAR_API_KEY` and `LINEAR_INITIATIVE_ID` in `.env.local`; never commit or
  expose them in browser code, generated HTML, fixtures, logs, or errors.
- Treat descriptions and comments as sensitive before publication. Continue to
  sanitize Linear Markdown through `src/lib/markdown.ts`; do not render raw HTML.
- In Linear-sourced Markdown, a hyperlink whose visible text ends in `*` is a
  publication marker: render its text without the link and remove the final `*`.
  This applies to the initiative about body as well as issues, projects, and comments.
- Private Linear-hosted images are replaced with a safe placeholder, and email
  addresses are redacted by the shared Markdown renderer.
- Initiative about body: `INITIATIVE_QUERY` must request both `description` and
  `content`. Normalize sets `summary` from `description` and
  `descriptionHtml` from `renderPublicMarkdown(content || description)`.

## Commands

- `npx astro build` — sync from Linear and generate `dist/`.
- `npm run sync` — refresh and validate the cached snapshot only.
- `npm run build:cached` — build from the existing cached snapshot without Linear.
- `npx astro dev` — develop against the cached snapshot without contacting Linear.
- `npm test` — run Vitest.
- `npm run check` — run Astro/TypeScript diagnostics.

For deterministic offline verification, build against the committed fixture:

```sh
LINEAR_SNAPSHOT_PATH=tests/fixtures/snapshot.json LINEAR_SKIP_SYNC=1 npx astro build
```

Before handing off changes, run the relevant tests, `npm run check`, the fixture
build above, and `git diff --check`. Never depend on live Linear access for tests.

## Implementation conventions

- Requires Node.js 22 or later and uses TypeScript/ES modules.
- Keep GraphQL queries compatible with Linear's public schema; validate query edits
  with `npx tsx scripts/validate-queries.ts /path/to/schema.graphql` when a schema is
  available.
- Add or update fixture-backed tests when changing extraction, normalization,
  Markdown safety, snapshot shape, view helpers, or dependency layout/routing.
- Do not edit generated `dist/` or `.cache/` artifacts as source files.
- Preserve unrelated worktree changes.

## Dependency graph

Code: `src/lib/dependency-layout.ts`, `src/components/DependencyGraph.astro`,
styles in `src/styles/global.css` (`.graph-*`).

### Hard layout constraints

- **Date-monotonic X:** Nodes are ordered by the page via `compareDependencyIssues`
  (`dueDate ?? project.targetDate`, undated last, then identifier). Layout places
  `x` strictly from that input order. Do **not** reorder across different dates
  for topological / layered flow. Same-date (or undated) ties may be refined only
  if still monotonic on the date key.
- **Y only optimizes vertical lanes** (with barycenter-style neighbor affinity).
  Prefer short chains to stay level; do not zig-zag adjacent hops without cause.
- **Deterministic:** no random forces; keep fixture/unit tests for order, clearance,
  and smoothness.

### Edge routing

- Prefer a near-chord / corridor path that clears intermediate node discs.
- Fall back to multi-segment rail detours with **G1 (smooth) joins** — climb and
  descend must share horizontal tangents with the rail (no visible corners).
- Score paths on clearance first, then length, mid-path drift from the chord, and
  joint smoothness. Dense collinear spines need multi-segment rails; single elevated
  cubics alone cannot clear near-endpoint obstacles.
- Attachment is **directional on the rim** (not only left/right sides).

### Presentation / interaction

- Node fill by Linear `state.type`: `unstarted`/`backlog` → blue (`.graph-node--todo`);
  `started` → teal (`.graph-node--started`); `completed`/`canceled` → grey
  (`.graph-node--done`); external boundaries stay dashed (`.graph-node--boundary`).
- Hover: thicken the hovered node, incident edges, and immediate neighbors; show
  SVG annotation chips (title + due date from `dependencyIssueDate`) for that set.
- Graph payload fields of note: `dueDate`, `statusType`, plus existing label/title/href.

## Timeline

Code: `src/components/Timeline.astro`, styles `.timeline-*` / `.project-bar*` in
`src/styles/global.css`.

### Product shape

- **Projects only:** date-range bars and project milestones. No issue due markers,
  no blocking dependency arrows, no project-status filter dropdown.
- Left column is the project name only (no status pills). Status is shown by
  **bar colour** and in tooltips / the accessible table.
- Bar classes by project `status.type`: `started` → teal; `planned`/`unstarted`/
  `backlog` → blue; `completed` → grey; `canceled` → warm grey.

### Axis, grid, and “today”

- Two-tier header: year bands on top, short month labels in cells below. Do **not**
  pack “Jan 2027” into a single crowded label row.
- Vertical body grid lines must use the **same calendar tick positions** as the
  header (table columns). Never use a fixed equal-percentage stripe (e.g. 8.333%)
  independent of the date range.
- Month thinning (every 2nd/3rd month) is shared between header and grid; January
  ticks stay for year boundaries.
- Track width is `max(preferred scale width, scroll client width − label width)` so
  Compact (and other scales) still fill a wide viewport; grid/headers must not stop
  short of the visible edge while the canvas stretches with `min-width: 100%`.
- **Today** line: orange dashed (`var(--accent)`), positioned from the **viewer’s
  local calendar date** in client JS (`new Date()`), not build time. `z-index`
  below project bars so the line passes behind them. Hide if outside the range.

## Notable paths

| Area | Path |
|---|---|
| Dependency layout/routing | `src/lib/dependency-layout.ts` |
| Dependency graph UI | `src/components/DependencyGraph.astro` |
| Timeline UI | `src/components/Timeline.astro` |
| Date / status helpers | `src/lib/view.ts` (`compareDependencyIssues`, `dependencyIssueDate`, `statusClass`) |
| Markdown / `*` links | `src/lib/markdown.ts` |
| Snapshot normalize | `src/lib/linear/normalize.ts` |
| Layout unit tests | `tests/dependency-layout.test.ts` |
