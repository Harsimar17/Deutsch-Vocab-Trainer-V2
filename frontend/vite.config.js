import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// The build goes straight into the jar's static folder: Spring Boot serves index.html and
// assets/ from classpath:static exactly as before. Files that only the backend serves
// (data/*.json, icons, talkloop/chatgpt.html, talkloop/piper.js) stay in
// src/main/resources/static and are copied there by Maven, so emptyOutDir stays off.
const BACKEND = "http://localhost:8080";
const staticDir = fileURLToPath(new URL("../src/main/resources/static", import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    // piper.js is also served on its own to the ChatGPT screen: one copy, imported from there.
    alias: { "@static": staticDir },
  },
  build: {
    outDir: "../target/classes/static",
    emptyOutDir: false,
    assetsDir: "assets",
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
  },
  server: {
    port: 5173,
    fs: { allow: [".", staticDir] },
    // `npm run dev` next to a running Spring Boot: the API and static data come from it.
    proxy: {
      "/api": BACKEND,
      "/mcp": BACKEND,
      "/data": BACKEND,
      "/talkloop/piper.js": BACKEND,
      "/talkloop/chatgpt.html": BACKEND,
    },
  },
});
