import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import content from "./server/content-plugin.js";

export default defineConfig({
  plugins: [react(), content()],
  server: { port: 5190, strictPort: true },
  preview: { port: 5190, strictPort: true },
  build: {
    chunkSizeWarningLimit: 1200,
    // three.js changes far less often than the site, so it gets its own long-cached file
    // (only index.html is built: /admin is a dev-server page and never ships)
    rollupOptions: { output: { manualChunks: { three: ["three"] } } },
  },
});
