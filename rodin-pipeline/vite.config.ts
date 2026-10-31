import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { userDataPlugin } from "./vite.user-data.mjs";

const corePath = new URL("../color-mix-lab/src/workflows/vertex/core", import.meta.url).pathname;
const repoRoot = new URL("..", import.meta.url).pathname;

export default defineConfig({
  base: "./",
  plugins: [react(), userDataPlugin()],
  resolve: {
    alias: {
      "@core": corePath,
    },
  },
  server: {
    // A fixed port keeps the browser origin (and everything stored in it) stable.
    port: 5173,
    strictPort: true,
    fs: {
      allow: [repoRoot],
    },
  },
  // The launcher serves the built app (dist/) on the same address, so whatever the
  // browser keeps for localhost:5173 carries over from the dev server.
  preview: {
    port: 5173,
    strictPort: true,
  },
  build: {
    // One local app with three.js inside: a single ~1.3 MB bundle is expected.
    chunkSizeWarningLimit: 2000,
  },
});
