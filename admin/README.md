# Photography dashboard release

Public site: https://zayedart.com
Owner dashboard: https://dashcontrol.zayedart.com

## Before merging into main

1. Confirm that the release branch workflow succeeds (tests, all image files,
   thumbnail generation and dashboard bundle). Download site-preview to inspect
   the exact static build if needed.
2. Public Cloudflare Worker zayedart: keep Production branch main and preview
   builds OFF. Set Build command to `npm run build` and keep Deploy command
   `npx wrangler deploy`. Node.js 22 or newer is required. The build installs
   dependencies from package.json, validates data, runs tests, decodes every
   image and generates the dist directory. Workers Builds does not honor
   Wrangler's custom build command; the dashboard Build command is required.
3. Create a Self-hosted Cloudflare Access application for the whole hostname
   dashcontrol.zayedart.com. Allow only your own email. Copy its application AUD
   and the team's <name>.cloudflareaccess.com domain.
4. Set ACCESS_AUD and ACCESS_TEAM_DOMAIN in admin/wrangler.jsonc to the copied
   non-secret values. GITHUB_BRANCH stays main for production.
5. Create a fine-grained GitHub PAT scoped ONLY to ahmedzaye/zayedart.com,
   Contents read/write, with an expiry. Save it as a Worker SECRET GITHUB_TOKEN.
   Never put it in GitHub files, browser JavaScript, screenshots, or chat.
   Optionally set ALLOWED_EMAILS as an additional comma-separated email allowlist.
6. Deploy the separate dashboard Worker from the repository root:
   `npx wrangler secret put GITHUB_TOKEN --config admin/wrangler.jsonc`
   `npx wrangler deploy --config admin/wrangler.jsonc`
   Alternatively connect a separate Workers Builds project to the same repo,
   use root directory `/` and deploy command
   `npx wrangler deploy --config admin/wrangler.jsonc`.
   Disable automatic preview builds on that Worker too.
7. Merge the tested release into main; wait for public deployment success before
   using the dashboard. A dashboard deployed before the merge cannot read the
   new JSON on main yet. Its API fails closed until Access and GitHub are set.

The dashboard's workers.dev and version preview URLs are disabled so the owner
UI is served only through its protected custom domain. API authorization is
also verified inside the Worker.

## Safe end-to-end test before production

Create a disposable branch from this release and set GITHUB_BRANCH to that
branch in a local development config. Use an isolated test Worker/domain with
its own Access AUD if testing on Cloudflare. Never test mutations against main.
Upload a small valid WebP with a title, description and date. Verify that one
commit contains the photo and JSON, edit it, move it to a temporary category,
then delete the test photo and empty category. Inspect that branch's Actions
build. Keep automatic previews disabled; use the generated site-preview artifact.
Production uses the same code with GITHUB_BRANCH main after this test.

## Local use

Create admin/.dev.vars from admin/.dev.vars.example, fill the token locally,
and run `npx wrangler dev --config admin/wrangler.jsonc` from the repo root.
The bypass requires BOTH ENVIRONMENT=development and DEV_BYPASS_AUTH=1 AND a
localhost/127.0.0.1 hostname. It cannot bypass authentication on a production
hostname. Never configure the bypass in Cloudflare.

## Content and publication

Every mutation writes images plus data/photography.json atomically in one Git
commit; no forced branch updates. Paths are limited to
assets/photography/<category>/<filename>.webp and data/photography.json.
Titles/descriptions/dates are optional; category names require both languages.
The reserved category id all is unavailable. Static WebP only, at most 40 MP,
20 files, 8 MiB per image and 40 MiB total (enforced before GitHub writes).
The browser decodes selected images; the Worker validates their RIFF/frame
structure; the build fully decodes originals before publication.

640-pixel WebP thumbnails are generated into dist/assets/photography-thumbnails;
originals are preserved and loaded when a visitor opens the lightbox. Thumbnails
are build output and are not committed into the source repository.

The dashboard distinguishes Saved to GitHub from Published. It checks the
public /_site/version.json for the saved commit (or a descendant). If this
cannot be confirmed in three minutes it asks you to inspect Cloudflare rather
than claiming success. Pending checks resume after a page reload.

## Recovery

Use GitHub's revert for the specific content commit if a photo or metadata was
changed by mistake. That creates a normal new deployment. For an emergency,
use Cloudflare's prior deployment rollback and separately revert the source;
otherwise the next main commit will restore the unwanted source state.
No original image file is modified by thumbnail generation.
