import index from "./index.html";
import { existsSync } from "node:fs";

const codecDir = ".squish";

if (!existsSync(`${codecDir}/codec.worker.js`)) {
  const proc = Bun.spawnSync(["bun", "scripts/build-codecs.ts", codecDir], {
    stdout: "inherit",
    stderr: "inherit",
  });
  if (!proc.success) process.exit(proc.exitCode);
}

const securityHeaders = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

const mime: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".wasm": "application/wasm",
};

const server = Bun.serve({
  port: process.env.PORT ? Number(process.env.PORT) : 3000,
  routes: {
    "/": index,
    "/:asset": {
      GET: (req) => {
        const asset = req.params.asset;
        if (!/^[\w.-]+\.(?:js|mjs|wasm)$/.test(asset)) return new Response("Not found", { status: 404 });
        const file = Bun.file(`${codecDir}/${asset}`);
        const ext = asset.slice(asset.lastIndexOf("."));
        return new Response(file, {
          headers: {
            ...securityHeaders,
            "Content-Type": mime[ext] ?? "application/octet-stream",
            "Cross-Origin-Resource-Policy": "same-origin",
          },
        });
      },
    },
  },
  development: {
    hmr: true,
    console: true,
  },
});

console.log(`Squish is running at ${server.url}`);
