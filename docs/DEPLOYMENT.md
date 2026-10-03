# Cloudflare Workers

Public site: https://orion.cogsci.workers.dev

The unified `main` branch targets Cloudflare Workers using Vinext and the Cloudflare Vite
plugin. The Worker handles page rendering and API routes; static assets include
the UGA and Illinois catalogs. This deployment does not use Sites hosting,
GitHub Pages, a database, or user accounts.

## Deploy an update

Use Node.js 22.13 or newer. From the repository root:

```bash
npm ci
npx wrangler login
npm run typecheck
npm run lint
npm run build
npm run test:full
npm run deploy
```

Login is needed only when this computer is not already authenticated. Confirm the
intended Cloudflare account with `npx wrangler whoami`. Deploying updates the
`orion` Worker in that account. If multiple accounts are available, select the
intended one or set `CLOUDFLARE_ACCOUNT_ID` explicitly.

`wrangler.jsonc` is the source configuration. The build produces the final
configuration in `dist/server/wrangler.json`, and Wrangler automatically follows
the build's redirect. Do not edit generated files in `dist`.

To test without publishing:

```bash
npm run build
npx wrangler deploy --dry-run
npm start -- --port 3001
```

Deployments are manual for now. A push to GitHub does not automatically publish.

## Saved plans and optional AI

Plans and preferences stay in each browser's local storage. They do not sync
across devices or transfer automatically from localhost to the public site.
Use the planner's export/import controls to move saved work. Changing to a new
domain also creates a separate storage origin, so export first.

The first public deployment does not configure `ANTHROPIC_API_KEY` or
`TRU_UPSTREAM`. Deterministic planning and browser-local features remain
available; model-powered advice and transcript extraction are not enabled.
Add authentication or appropriate abuse controls and spending limits before
enabling paid AI endpoints for anonymous visitors. Keep keys out of source,
`NEXT_PUBLIC_*` variables, and the public assets directory; use Cloudflare
Worker secrets when these features are ready.

## Domains

The URL format is `https://<worker-name>.<account-subdomain>.workers.dev`.
`orion` comes from the Worker name in `wrangler.jsonc`; `cogsci` is the
Cloudflare account's current Workers subdomain.

A custom domain can be connected later in the Worker's domain settings. Update
`NEXT_PUBLIC_SITE_URL` in `wrangler.jsonc` and redeploy when the public origin
changes. No custom domain or paid database was provisioned for this launch.
