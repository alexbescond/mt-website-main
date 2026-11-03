# Conductor handoff — Les aventures de mon doudou et ma tétine

## Workspace

Target on the user's Mac:
`/Users/alexandreb/conductor/workspaces/mt-website-main/san-francisco`

This handoff was prepared in a remote session. Nothing has been copied into the Mac workspace yet. The redesign has not been pushed or deployed: the GitHub integration rejected writes with "Resource not accessible by integration".

## Import the completed changes

The sibling `refonte.patch` contains all 25 changed/new files, including the binary WebP hero illustration. It is a complete binary Git diff, not a partial text export.

- Base commit: `07d51a16c48bb960359b070ffa33633f2a026bd5`
- Completed local commit: `745cadd1e13a004272bcdb42a39e640cc2e32df0`
- Patch SHA-256: `5c51ed3cb11a6668169f26cbdcae306c54b63d44be619744e76dd82de55c2cbc`

From the target workspace, inspect `git status` and any applicable `AGENTS.md`. Do not reset, discard, or overwrite unrelated local work. The checkout may be newer than the base above.

```sh
git apply --stat conductor-handoff/refonte.patch
git apply --check conductor-handoff/refonte.patch
git apply conductor-handoff/refonte.patch
```

Only apply after the check succeeds. If there are conflicts, reconcile the patch with the current files while preserving existing local changes. Do not use `--reject`, a hard reset, or a force overwrite. If the changes are already present, do not apply twice. The patch is verified to reproduce the completed commit's exact source tree when applied to its base, including binary assets. Importing it does not create a commit or publish the site.

## Product and implementation

- Brand: **Les aventures de mon doudou et ma tétine**.
- Warm cream travel-journal design, responsive navigation, home page, adventures catalogue, project story, FAQ, book preview, information and confirmation pages.
- Personalization supports either a doudou or a tétine, optional companion nickname, child's first name, companion photo and child's photo.
- Tétine stories gently accompany separation. Doudou stories do not imply the child must give up their doudou.
- Existing two demo adventures (tropics and ski) and provisional EUR 29.90 price retained. Postcards and travel journals are future ideas, not products sold by this implementation.
- Companion type/nickname pass through server validation and D1 storage. Stripe titles reflect the companion type; child names, nicknames and photos are not sent to Stripe.
- Additive migration `migrations/0002_companions.sql`; historical photo field/storage names retained for compatibility.
- CI/CD, `wrangler.jsonc`, Astro configuration, deployment scripts, dependency manifests and existing payment mode are unchanged by this patch.
- No real payments have been enabled. Keep the demo configuration until the user explicitly prepares Stripe and sales launch.

## Verification and next steps

Prior session reported passing type checks and 12 server tests, plus partial visual inspection. A complete desktop/mobile Playwright pass was not confirmed; do not report it as complete. This handoff verifies patch application and exact source-tree equality, not a fresh application test run.

Use Node 24 as in the repository documentation:

```sh
npm ci
npm run db:migrate:local
npm run check:types
npm test
npx playwright install chromium
npm run test:e2e
npm run preview
```

Run the preview as a separate/long-running process after checks; it serves on `http://localhost:8787`. Inspect desktop and mobile, the three-step personalization form, image previews, demo confirmation, navigation and book preview. Check the most recently adjusted form compatibility, and distinguish test results from unverified assumptions.

Do not deploy just to import this handoff. Let the user review the result in Conductor and follow the repository's established Git/Cloudflare workflow for any subsequent publication. Keep Cloudflare and CI settings intact.

Existing Cloudflare URL: `https://mt-website-main.alexandre-bescond.workers.dev` (existing deployment, not the unpublished redesign). The README retains this URL; its mention does not establish that the redesign is deployed.

Before accepting real orders, finalize book specifications, delivery commitments, seller/legal information, R2 configuration, Stripe setup and fulfillment. See `README.md`, `DEPLOY.md` and `docs/ASSETS.md` for the existing implementation details.
