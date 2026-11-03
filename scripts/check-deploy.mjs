import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const config = JSON.parse(readFileSync("dist/server/wrangler.json", "utf8"));
function assert(ok, message) {
  if (!ok) {
    console.error(message);
    process.exit(1);
  }
}
const target = process.argv[2];
assert(["staging", "production"].includes(target), "Specify staging or production as the deployment target.");
const production = target === "production";
if (process.argv.includes("--require-live")) {
  assert(production, "Payment launch checks must target production.");
  assert(config.vars.CHECKOUT_MODE === "live", "Production payments are not enabled: set CHECKOUT_MODE=live only after completing the launch steps in DEPLOY.md.");
}
const expected = production ? {
  name: "mt-main-production",
  origin: "https://les-aventures-de-doudou-tetine.com",
  database: "812fcaec-fe77-40c5-8ac6-363104dbf213",
  session: "72e6c73cbf1e400e902d27c8f4bbd53a",
  photos: "mt-private-photos-production",
} : {
  name: "mt-website-main",
  origin: "https://mt-website-main.alexandre-bescond.workers.dev",
  database: "d7c82687-ed9b-4607-82a7-80fea80e71f7",
  session: "9f532fb7c2034ef29d5e63881533b225",
  photos: "mt-private-photos-staging",
};
assert(config.name === expected.name, `Wrong build for ${target}. Rebuild with the intended Cloudflare environment.`);
assert(config.vars.SITE_ORIGIN === expected.origin, "Unexpected site origin.");
if (production) {
  assert(config.vars.CHECKOUT_MODE !== "test", "Production must never use Stripe sandbox payments.");
  assert(config.workers_dev === false && config.preview_urls === false, "Production must not expose workers.dev or preview URLs.");
  assert(config.routes?.length === 1 && config.routes[0].pattern === "les-aventures-de-doudou-tetine.com/*", "Production must use its protected custom domain.");
  assert(config.vars.SITE_INDEXABLE === "false", "Production remains private until public launch is authorized.");
} else {
  assert(!config.routes?.length, "Staging must not claim a custom production domain.");
  assert(config.vars.CHECKOUT_MODE !== "live", "Live payments are forbidden on staging.");
}
assert(
  config.d1_databases?.some(
    (b) =>
      b.binding === "DB" &&
      b.database_id === expected.database,
  ),
  "Wrong D1 binding for this environment.",
);
assert(
  config.kv_namespaces?.some(
    (b) => b.binding === "SESSION" && b.id === expected.session,
  ),
  "Wrong SESSION binding for this environment.",
);
assert(
  ["demo", "test", "live"].includes(config.vars.CHECKOUT_MODE),
  "Invalid CHECKOUT_MODE.",
);
if (config.vars.CHECKOUT_MODE !== "demo") {
  assert(
    config.r2_buckets?.some(
      (b) => b.binding === "PHOTOS" && b.bucket_name === expected.photos && b.jurisdiction === "eu",
    ),
    "Enable R2 and add the private PHOTOS binding before enabling checkout.",
  );
  const result = spawnSync(
    "npx",
    ["wrangler", "secret", "list", "--config", "dist/server/wrangler.json", "--name", config.name,
      ...(process.env.WRANGLER_PROFILE ? ["--profile", process.env.WRANGLER_PROFILE] : [])],
    { encoding: "utf8" },
  );
  assert(result.status === 0, "Cannot verify deployed secret names.");
  const secrets = JSON.parse(result.stdout);
  const requiredSecrets = ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "ADMIN_PASSWORD", "TRACKING_LINK_SECRET"];
  if (config.vars.CHECKOUT_MODE === "live") requiredSecrets.push("RESEND_API_KEY");
  const missing = requiredSecrets.filter(key => !secrets.some(s => s.name === key));
  assert(!missing.length, `Missing Worker secrets: ${missing.join(", ")}`);
}
if (config.vars.CHECKOUT_MODE === "live") {
  assert(["17 3 * * *", "*/5 * * * *"].every(cron => config.triggers?.crons?.includes(cron)), "Enable photo retention and notification schedules before opening sales.");
  assert(config.vars.EMAIL_ENABLED === "true", "Enable transactional notifications before opening sales.");
  assert(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.vars.EMAIL_FROM || ""), "Set EMAIL_FROM to an address on a domain verified in Resend.");
}
if (config.vars.CHECKOUT_MODE === "live") {
  // Stripe cannot authenticate through Cloudflare Access. This unsigned probe
  // must reach our handler and be rejected before any order or payment is touched.
  const response = await fetch(`${expected.origin}/api/stripe/webhook`, {
    method: "POST",
    redirect: "manual",
    signal: AbortSignal.timeout(10000),
  }).catch(() => null);
  const body = await response?.json().catch(() => null);
  assert(response?.status === 400 && body?.error === "Signature manquante.",
    "Stripe webhook is not reachable: configure the production webhook, its Worker secrets and the exact-path Cloudflare Access bypass before opening sales.");
}
console.log(
  `Deployment configuration checked (${target}, ${config.vars.CHECKOUT_MODE}). Secret values are never printed.`,
);
