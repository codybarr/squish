# Squish

A private, browser-only image compressor inspired by Squoosh with bulk upload as the primary workflow.

## Features

- Client-side WASM codecs via `@jsquash/*`
- Bulk PNG, JPG, AVIF, and WebP upload
- Convert freely between PNG, JPG, AVIF, and WebP
- Opinionated compression defaults, no quality sliders
- Optional resize by width/height with aspect-ratio lock enabled by default
- One-click per-file downloads and staggered download-all for finished files

## Development

```bash
bun install
bun run dev
```

Open <http://localhost:3000>.

## Production build

```bash
bun run build
```

The `dist/` directory contains the bundled app, codec worker, and required WASM assets. Serve it as static files from the site root so `/codec.worker.js` and the codec `.wasm` files resolve next to each other. For best AVIF performance, serve with `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` headers.
