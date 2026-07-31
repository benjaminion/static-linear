# Linear initiative site

A static, public-facing view of one Linear initiative. Linear is contacted only at build/sync time; the generated site never receives the API key.

## Setup

Requires Node.js 22 or later.

1. Copy `.env.example` to `.env.local`.
2. Set `LINEAR_API_KEY` and the initiative's UUID (`Copy model UUID` in Linear's command menu).
3. Run `npm install`.

## Commands

- `npx astro build` — refresh Linear data and generate `dist/`.
- `npx astro dev` — serve the cached snapshot without contacting Linear.
- `npx astro preview` — serve the production output.
- `npm run sync` — refresh and validate the snapshot without building.
- `npm run build:cached` — build offline from the last valid snapshot.
- `npm test` — run the automated test suite.

For API maintenance, download Linear's public `schema.graphql` and run
`npx tsx scripts/validate-queries.ts /path/to/schema.graphql` to validate every query without contacting a workspace.

The cached snapshot, build output, and all `.env` files are ignored by Git. The snapshot is intentionally public-safe but still contains issue descriptions and comments; review `dist/` before publishing it.
