import { defineConfig } from "vite";

// public/ only holds the sprites extracted for development (npm run extract): CipSoft's artwork, so builds
// leave it out and players read their own client in the browser instead (src/assets.ts).
export default defineConfig(({ command }) => ({
  base: "./",
  publicDir: command === "serve" ? "public" : false,
  worker: { format: "es" },
}));
