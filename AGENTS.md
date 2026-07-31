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
- `content/initiative-overview.md` is user-authored public copy for the homepage.
  Normal sync/builds must not replace it or fetch the initiative description.
  `npm run pull:initiative-overview` is a temporary, explicitly invoked seeding
  helper and overwrites that file, so do not run it unless the user asks.

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
  This rule does not apply to local Markdown such as the initiative overview.
- Private Linear-hosted images are replaced with a safe placeholder, and email
  addresses are redacted by the shared Markdown renderer.

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
  Markdown safety, snapshot shape, or view helpers.
- Do not edit generated `dist/` or `.cache/` artifacts as source files.
- Preserve user edits in `content/initiative-overview.md` and unrelated worktree
  changes.
