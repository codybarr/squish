import { mkdir, readdir, copyFile, rm } from "node:fs/promises";
import { join, basename } from "node:path";

const outdir = process.argv[2] ?? ".squish";

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const path = join(dir, entry.name);
      return entry.isDirectory() ? walk(path) : Promise.resolve([path]);
    }),
  );
  return files.flat();
}

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

const result = await Bun.build({
  entrypoints: ["./src/codec.worker.ts"],
  outdir,
  target: "browser",
  format: "esm",
  minify: process.env.NODE_ENV === "production",
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

const assetRoots = [
  "node_modules/@jsquash/jpeg",
  "node_modules/@jsquash/png",
  "node_modules/@jsquash/webp",
  "node_modules/@jsquash/avif",
  "node_modules/@jsquash/resize",
];

for (const root of assetRoots) {
  const assets = (await walk(root)).filter((file) => /\.(wasm|mjs)$/.test(file));
  for (const asset of assets) {
    await copyFile(asset, join(outdir, basename(asset)));
  }
}

console.log(`Built codec worker and WASM assets into ${outdir}`);
