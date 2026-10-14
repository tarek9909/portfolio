import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { port: 5190, strictPort: true },
  preview: { port: 5190, strictPort: true },
  build: {
    chunkSizeWarningLimit: 1200,
    // three.js changes far less often than the site, so it gets its own long-cached file
    rollupOptions: { output: { manualChunks: { three: ["three"] } } },
  },
});
