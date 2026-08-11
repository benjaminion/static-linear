# Linear initiative site

A static, invite-only view of one Linear initiative. Linear is contacted only at build/sync time; the generated site never receives the API key. The deployed site is protected by Google authentication through Cloudflare Access.

## Setup

Requires Node.js 22 or later.

1. Copy `.env.example` to `.env.local`.
2. Set `LINEAR_API_KEY` and the initiative's UUID (`Copy model UUID` in Linear's command menu).
3. Run `npm install`.

Edit `content/initiative-overview.md` to provide the public copy shown under
“About this initiative”. This local file replaces the longer initiative body in Linear;
that Linear field is not fetched or written to the public snapshot.

To seed that file once from the current Linear body, run
`npm run pull:initiative-overview`. The helper overwrites the placeholder atomically;
normal builds never fetch this field.

## Commands

- `npx astro build` — refresh Linear data and generate `dist/`.
- `npx astro dev` — serve the cached snapshot without contacting Linear.
- `npx astro preview` — serve the production output.
- `npm run sync` — refresh and validate the snapshot without building.
- `npm run build:cached` — build offline from the last valid snapshot.
- `npm run deploy` — refresh from Linear, build, and deploy the static output to Cloudflare.
- `npm test` — run the automated test suite.

For API maintenance, download Linear's public `schema.graphql` and run
`npx tsx scripts/validate-queries.ts /path/to/schema.graphql` to validate every query without contacting a workspace.

The cached snapshot, build output, and all `.env` files are ignored by Git. The snapshot is intentionally public-safe but still contains issue descriptions and comments; review `dist/` before publishing it.

## Protected deployment

The site deploys as Cloudflare Workers Static Assets. There is no Worker script,
server-side rendering, or runtime access to Linear. `wrangler.jsonc` disables the
otherwise public `workers.dev` and preview URLs; attach a custom domain to the
Worker before deploying it for invitees.

### One-time Cloudflare setup

1. Add the site's domain to Cloudflare and authenticate Wrangler locally with
   `npx wrangler login`.
2. Run `npm run deploy` once to create the `linear-initiative-site` Worker, then
   attach the intended custom domain under **Workers & Pages →
   linear-initiative-site → Settings → Domains & Routes**.
3. In Google Cloud, create an OAuth web client with an External audience. Use the
   Cloudflare team URL as the authorized JavaScript origin and
   `https://<team-name>.cloudflareaccess.com/cdn-cgi/access/callback` as the
   redirect URI. Keep the client secret in Google and Cloudflare; do not add it
   to this repository or `.env.local`.
4. In **Cloudflare One → Integrations → Identity providers**, add the generic
   **Google** provider and test it. This provider accepts both personal Google
   accounts and Google Workspace accounts. Configure the Access application to
   offer only this login method.
5. In **Cloudflare One → Access controls → Policies**, create a reusable Allow
   policy named `Initiative invitees` with a 24-hour session:
   - Add individual invitees with the **Emails** selector.
   - Add whole invited domains with **Emails ending in**, for example
     `@example.com`.
   - Keep all entries as **Include** rules so they are combined with OR logic.
   - Require the Google login method. Do not add an Everyone or Bypass rule.
6. Create a self-hosted Access application, select the
   `linear-initiative-site` Worker as its destination, cover the Worker and its
   preview deployments, and attach the `Initiative invitees` policy. Protect the
   whole application, without public path exceptions.

### Maintaining access

Edit the `Initiative invitees` policy in the Cloudflare dashboard to add or
remove exact addresses and domains. A domain entry grants access to every Google
account whose verified email ends in that exact domain; it does not include
subdomains unless they are listed separately.

Removing an entry prevents new sessions, but an existing application token can
remain valid for up to the 24-hour session duration. For urgent removal, revoke
the user under Cloudflare Access immediately. Invitees can end their own session
with the **Sign out** navigation link.

Cloudflare Access checks authentication before serving every generated file, so
an `.htaccess` file is neither used nor needed. This prevents unauthenticated
downloads; it cannot prevent an authorized visitor from saving or copying content
they are permitted to view.
