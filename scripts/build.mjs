import { build } from "esbuild";
import { argv } from "process";

const watch = argv.includes("--watch");

const ctx = await build({
  entryPoints: ["src/extension.js"],
  bundle: true,
  outfile: "dist/extension.cjs",
  format: "cjs",
  platform: "node",
  target: "node20",
  external: [
    "vscode",
    // Native modules that can't be bundled
    "better-sqlite3",
    "node-pty",
    "tree-sitter",
    "tree-sitter-go",
    "tree-sitter-javascript",
    "tree-sitter-php",
    "tree-sitter-python",
    "tree-sitter-rust",
  ],
  // agent-core and browser-ai-bridge are ESM — import() at runtime
  // so they don't need to be bundled
  packages: "external",
  sourcemap: true,
  logLevel: "info",
});

if (watch) {
  console.log("Watching for changes...");
  await ctx.watch();
}
