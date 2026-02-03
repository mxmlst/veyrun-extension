import { build, context } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const dist = path.resolve(root, "..", "dist", "extension");

const isWatch = process.argv.includes("--watch");

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

const buildOptions = {
  entryPoints: {
    background: path.resolve(root, "src", "background.ts"),
    content: path.resolve(root, "src", "content.ts"),
    popup: path.resolve(root, "src", "popup.ts"),
    debug: path.resolve(root, "src", "debug.ts"),
    confirm: path.resolve(root, "src", "confirm.ts")
  },
  outdir: dist,
  bundle: true,
  format: "esm",
  target: "es2020",
  sourcemap: true
};

if (isWatch) {
  const ctx = await context(buildOptions);
  await ctx.watch();
} else {
  await build(buildOptions);
}

await cp(path.resolve(root, "public", "manifest.json"), path.resolve(dist, "manifest.json"));
await cp(path.resolve(root, "public", "icon.png"), path.resolve(dist, "icon.png"));
await cp(path.resolve(root, "src", "popup.html"), path.resolve(dist, "popup.html"));
await cp(path.resolve(root, "src", "popup.css"), path.resolve(dist, "popup.css"));
await cp(path.resolve(root, "src", "confirm.html"), path.resolve(dist, "confirm.html"));
await cp(path.resolve(root, "src", "confirm.css"), path.resolve(dist, "confirm.css"));
await cp(path.resolve(root, "src", "debug.html"), path.resolve(dist, "debug.html"));
await cp(path.resolve(root, "src", "debug.css"), path.resolve(dist, "debug.css"));
