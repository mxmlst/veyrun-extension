import { build, context } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const distRoot = path.resolve(root, "..", "dist");

const isWatch = process.argv.includes("--watch");
const targetArg = process.argv.find((arg) => arg.startsWith("--target="));
const target = targetArg ? targetArg.split("=")[1] : null;
const targets = target ? [target] : ["chrome", "firefox"];

const buildTarget = async (targetName) => {
  const dist = path.resolve(
    distRoot,
    targetName === "firefox" ? "extension-firefox" : "extension-chrome",
  );

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
    format: targetName === "firefox" ? "iife" : "esm",
    target: "es2020",
    sourcemap: true
  };

  if (isWatch) {
    const ctx = await context(buildOptions);
    await ctx.watch();
  } else {
    await build(buildOptions);
  }

  const manifest =
    targetName === "firefox" ? "manifest.firefox.json" : "manifest.json";

  await cp(path.resolve(root, "public", manifest), path.resolve(dist, "manifest.json"));
  await cp(path.resolve(root, "public", "icon-16.png"), path.resolve(dist, "icon-16.png"));
  await cp(path.resolve(root, "public", "icon-48.png"), path.resolve(dist, "icon-48.png"));
  await cp(path.resolve(root, "public", "icon-128.png"), path.resolve(dist, "icon-128.png"));
  await cp(path.resolve(root, "src", "popup.html"), path.resolve(dist, "popup.html"));
await cp(path.resolve(root, "src", "extension.css"), path.resolve(dist, "extension.css"));
await cp(path.resolve(root, "src", "confirm.html"), path.resolve(dist, "confirm.html"));
  await cp(path.resolve(root, "src", "debug.html"), path.resolve(dist, "debug.html"));
  await cp(path.resolve(root, "src", "debug.css"), path.resolve(dist, "debug.css"));
};

if (isWatch && !target) {
  await buildTarget("chrome");
} else {
  for (const targetName of targets) {
    await buildTarget(targetName);
  }
}
