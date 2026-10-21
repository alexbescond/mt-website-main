import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
export default defineConfig({
  plugins: [
    cloudflareTest({
      main: "./tests/api/worker.ts",
      // Deliberately independent from local .dev.vars and remote production resources.
      miniflare: {
        compatibilityDate: "2026-10-17",
        compatibilityFlags: ["nodejs_compat"],
        d1Databases: ["DB"],
        r2Buckets: ["PHOTOS"],
        kvNamespaces: ["SESSION"],
        bindings: {
          SITE_ORIGIN: "https://les-vacances-de-ma-tetine.com",
          CHECKOUT_MODE: "test",
          LEGAL_APPROVED: "false",
          SITE_INDEXABLE: "false",
          STRIPE_SECRET_KEY: "sk_test_fixture_not_a_real_key",
          STRIPE_WEBHOOK_SECRET: "whsec_fixture_not_a_real_secret",
        },
      },
    }),
  ],
  test: { include: ["tests/api/**/*.test.ts"], fileParallelism: false },
});
