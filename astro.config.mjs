import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";

export default defineConfig({
  site: "https://les-vacances-de-ma-tetine.com",
  output: "static",
  build: { format: "file" },
  adapter: cloudflare({ inspectorPort: false, imageService: "compile" }),
  devToolbar: { enabled: false },
  // Keep even small client scripts external so the strict CSP can allow only self.
  vite: { build: { assetsInlineLimit: 0 } },
});
