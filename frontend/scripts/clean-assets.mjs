// Removes the previous build's hashed files before a new build, so old bundles don't pile up
// in target/classes/static/assets. Only that folder is touched: the rest of static/ comes
// from src/main/resources/static (data, icons, the ChatGPT screen) and must stay.
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

rmSync(fileURLToPath(new URL("../../target/classes/static/assets", import.meta.url)), { recursive: true, force: true });
