// Preloaded into every Node process of the build (see run-vite.mjs). On some Windows machines
// Node's random generator fails to start ("entropy source strength too weak") when its first
// use comes from inside esbuild's WebAssembly runtime. Asking for a few random bytes before
// anything else starts it normally.
require("crypto").randomFillSync(Buffer.alloc(32));
