import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const config = JSON.parse(readFileSync("dist/server/wrangler.json", "utf8"));
function assert(ok, message) {
  if (!ok) {
    console.error(message);
    process.exit(1);
  }
}
assert(config.name === "mt-website-main", "Unexpected Worker name.");
assert(
  config.d1_databases?.some(
    (b) =>
      b.binding === "DB" &&
      b.database_id &&
      !b.database_id.startsWith("00000000"),
  ),
  "Provision mt-orders and set its D1 ID in wrangler.jsonc.",
);
assert(
  config.kv_namespaces?.some(
    (b) => b.binding === "SESSION" && b.id && !b.id.startsWith("00000000"),
  ),
  "Provision SESSION and set its KV ID in wrangler.jsonc.",
);
assert(
  ["demo", "test", "live"].includes(config.vars.CHECKOUT_MODE),
  "Invalid CHECKOUT_MODE.",
);
if (config.vars.CHECKOUT_MODE !== "demo") {
  assert(
    config.r2_buckets?.some(
      (b) => b.binding === "PHOTOS" && b.bucket_name === "mt-private-photos",
    ),
    "Enable R2 and add the private PHOTOS binding before enabling checkout.",
  );
  const result = spawnSync(
    "npx",
    ["wrangler", "secret", "list", "--name", config.name],
    { encoding: "utf8" },
  );
  assert(result.status === 0, "Cannot verify deployed secret names.");
  const secrets = JSON.parse(result.stdout);
  for (const key of ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"])
    assert(
      secrets.some((s) => s.name === key),
      `Missing Worker secret: ${key}`,
    );
}
if (config.vars.CHECKOUT_MODE === "live")
  assert(
    config.vars.LEGAL_APPROVED === "true",
    "Finalize the seller details, product specification and terms before enabling live payments.",
  );
console.log(
  `Deployment configuration checked (${config.vars.CHECKOUT_MODE}). Secret values are never printed.`,
);
