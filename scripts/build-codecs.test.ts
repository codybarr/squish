import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("copies every AVIF pthread runtime dependency", async () => {
  const outdir = await mkdtemp(join(tmpdir(), "squish-codecs-"));

  try {
    const build = Bun.spawn(["bun", "scripts/build-codecs.ts", outdir], {
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await build.exited).toBe(0);

    const pthreadWorker = await Bun.file(
      join(outdir, "avif_enc_mt.worker.mjs"),
    ).text();
    expect(pthreadWorker).toContain('import("./avif_enc_mt.js")');
    expect(await Bun.file(join(outdir, "avif_enc_mt.js")).exists()).toBe(true);
    expect(await Bun.file(join(outdir, "avif_enc_mt.wasm")).exists()).toBe(true);
  } finally {
    await rm(outdir, { recursive: true, force: true });
  }
});
