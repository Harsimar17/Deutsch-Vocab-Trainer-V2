// Runs Vite ("build" or "dev") with warm-crypto.cjs preloaded into this process and every child
// process (esbuild's), so the WebAssembly build tools work on locked-down Windows machines too.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const warm = fileURLToPath(new URL("./warm-crypto.cjs", import.meta.url));
require(warm);
process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS ?? ""} --require "${warm.replace(/\\/g, "/")}"`.trim();

const mode = process.argv[2] ?? "build";
const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await import("vite");
if (mode === "dev") {
  const server = await vite.createServer({ root });
  await server.listen();
  server.printUrls();
} else {
  await import("./clean-assets.mjs");
  await vite.build({ root });
}
