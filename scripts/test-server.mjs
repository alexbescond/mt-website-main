import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, {
    stdio: "inherit",
    env: { ...process.env, CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false" },
  });
  if (r.status !== 0) process.exit(r.status || 1);
};
run("npm", ["run", "build"]);
const config = JSON.parse(readFileSync("dist/server/wrangler.json", "utf8"));
const directory = path.resolve(".context/e2e");
mkdirSync(directory, { recursive: true });
config.main = path.resolve("dist/server", config.main);
config.assets.directory = path.resolve("dist/server", config.assets.directory);
config.vars = {
  ...config.vars,
  CHECKOUT_MODE: "demo",
  SITE_INDEXABLE: "false",
  LEGAL_APPROVED: "false",
};
config.d1_databases[0].database_id = "00000000-0000-0000-0000-000000000000";
config.d1_databases[0].migrations_dir = path.resolve("migrations");
config.r2_buckets = [{ binding: "PHOTOS", bucket_name: "mt-e2e-private-photos" }];
config.kv_namespaces[0].id = "00000000000000000000000000000000";
config.triggers = { crons: [] };
delete config.routes;
const configPath = path.join(directory, "wrangler.json");
writeFileSync(configPath, JSON.stringify(config));
// This empty vars file prevents Wrangler from loading developer Stripe credentials.
writeFileSync(path.join(directory, ".dev.vars"), "");
const persist = path.resolve(".wrangler/e2e-state");
run("npx", [
  "wrangler",
  "d1",
  "migrations",
  "apply",
  "mt-orders",
  "--local",
  "--config",
  configPath,
  "--persist-to",
  persist,
]);
const child = spawn(
  "npx",
  [
    "wrangler",
    "dev",
    "--local",
    "--config",
    configPath,
    "--persist-to",
    persist,
    "--port",
    "8790",
    "--inspector-port",
    "0",
  ],
  {
    stdio: "inherit",
    env: { ...process.env, CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false" },
  },
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    child.kill(signal);
  });
child.on("exit", (code) => process.exit(code || 0));
