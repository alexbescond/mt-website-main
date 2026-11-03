import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";

export default defineConfig({
  site: process.env.CLOUDFLARE_ENV === "production"
    ? "https://les-aventures-de-doudou-tetine.com"
    : "https://mt-website-main.alexandre-bescond.workers.dev",
  output: "static",
  build: { format: "file" },
  adapter: cloudflare({ inspectorPort: false, imageService: "compile" }),
  devToolbar: { enabled: false },
  // Keep even small client scripts external so the strict CSP can allow only self.
  vite: { build: { assetsInlineLimit: 0 } },
});
