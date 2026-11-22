# Zayed Art — Photography Dashboard

Worker + static dashboard served at `admin.zayedart.com`.
Every action (upload / edit / delete / category change) is ONE commit to `main`
that updates `data/photography.json` (+ image files), so the normal site deploy runs.

## One-time setup (in this order)

1. **GitHub token** — Settings → Developer settings → Fine-grained tokens.
   Only the `zayedart.com` repo, permission **Contents: Read and write**. Nothing else.
2. **Protect the domain first** — Cloudflare Zero Trust → Access → Applications → *Self-hosted*:
   - Domain: `admin.zayedart.com`
   - Policy: Allow → Emails → your email
   - Copy the application's **AUD tag**, and your **team domain** (`<name>.cloudflareaccess.com`).
3. Put both values in `admin/wrangler.jsonc` (`ACCESS_AUD`, `ACCESS_TEAM_DOMAIN`).
4. Deploy from this folder:
   ```bash
   cd admin
   npx wrangler secret put GITHUB_TOKEN      # paste the token
   npx wrangler deploy                       # creates the admin.zayedart.com custom domain
   ```

The Worker re-verifies the Access JWT on every `/api/*` call, so it stays closed
even if the Access policy is misconfigured. Optional extra allow-list:
`npx wrangler secret put ALLOWED_EMAILS` (comma separated).

## Local development

```bash
cd admin
printf 'GITHUB_TOKEN=...\nDEV_BYPASS_AUTH=1\n' > .dev.vars   # gitignored; never set DEV_BYPASS_AUTH in production
npx wrangler dev
```

## Limits

20 photos / 8 MB each / 40 MB per upload. WebP only (checked server-side).
Moving more than 30 photos between categories in one go is rejected (split it).

## Data format

`data/photography.json` → `{ categories: [{id, name:{en,ar}}], photos: [{src, category, title, description, takenAt, uploadedAt}] }`.
Gallery order: `takenAt` newest first, undated last (then newest `uploadedAt`).
The `Validate photography data` workflow fails the push if a listed file is missing or a field is malformed.
