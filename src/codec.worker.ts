import { decode as decodeJpeg, encode as encodeJpeg } from "@jsquash/jpeg";
import { decode as decodePng, encode as encodePng } from "@jsquash/png";
import { decode as decodeWebp, encode as encodeWebp } from "@jsquash/webp";
import { decode as decodeAvif, encode as encodeAvif } from "@jsquash/avif";
import resize from "@jsquash/resize";

type OutputFormat = "jpg" | "png" | "webp" | "avif";

type Job = {
  id: string;
  fileName: string;
  sourceType: string;
  buffer: ArrayBuffer;
  format: OutputFormat;
  resize?: { width?: number; height?: number; lockAspect: boolean };
};

type WorkerRequest = { type: "process"; job: Job };

type WorkerResponse =
  | {
      type: "done";
      id: string;
      blob: Blob;
      width: number;
      height: number;
      originalBytes: number;
      outputBytes: number;
      outputName: string;
    }
  | { type: "error"; id: string; message: string };

const extensions: Record<OutputFormat, string> = {
  jpg: "jpg",
  png: "png",
  webp: "webp",
  avif: "avif",
};

const mimeTypes: Record<OutputFormat, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  avif: "image/avif",
};

function inferFormat(mime: string, fileName: string): OutputFormat {
  const lower = `${mime} ${fileName}`.toLowerCase();
  if (lower.includes("avif") || lower.endsWith(".avif")) return "avif";
  if (lower.includes("webp") || lower.endsWith(".webp")) return "webp";
  if (lower.includes("png") || lower.endsWith(".png")) return "png";
  return "jpg";
}

async function decode(buffer: ArrayBuffer, mime: string, fileName: string): Promise<ImageData> {
  const format = inferFormat(mime, fileName);
  switch (format) {
    case "png":
      return decodePng(buffer);
    case "webp":
      return decodeWebp(buffer);
    case "avif": {
      const decoded = await decodeAvif(buffer);
      if (!decoded) throw new Error("AVIF decoder returned no pixels.");
      return decoded;
    }
    case "jpg":
      return decodeJpeg(buffer, { preserveOrientation: true });
  }
}

function flattenForJpeg(image: ImageData): ImageData {
  const src = image.data;
  let hasAlpha = false;
  for (let i = 3; i < src.length; i += 4) {
    if (src[i] !== 255) {
      hasAlpha = true;
      break;
    }
  }
  if (!hasAlpha) return image;

  const out = new Uint8ClampedArray(src.length);
  for (let i = 0; i < src.length; i += 4) {
    const alpha = src[i + 3]! / 255;
    out[i] = Math.round(src[i]! * alpha + 255 * (1 - alpha));
    out[i + 1] = Math.round(src[i + 1]! * alpha + 255 * (1 - alpha));
    out[i + 2] = Math.round(src[i + 2]! * alpha + 255 * (1 - alpha));
    out[i + 3] = 255;
  }
  return new ImageData(out, image.width, image.height);
}

async function encode(image: ImageData, format: OutputFormat): Promise<ArrayBuffer> {
  switch (format) {
    case "jpg":
      return encodeJpeg(flattenForJpeg(image), {
        quality: 82,
        progressive: true,
        optimize_coding: true,
        trellis_multipass: true,
        trellis_opt_zero: true,
        trellis_opt_table: true,
        auto_subsample: true,
      });
    case "png":
      return encodePng(image);
    case "webp":
      return encodeWebp(image, { quality: 78, method: 6, pass: 6, sns_strength: 80 });
    case "avif":
      return encodeAvif(image, { quality: 56, qualityAlpha: 70, speed: 6, subsample: 1, chromaDeltaQ: false, tune: 0 });
  }
}

function dimensionsFor(image: ImageData, job: Job): { width: number; height: number } | null {
  const widthInput = job.resize?.width;
  const heightInput = job.resize?.height;
  if (!job.resize || (!widthInput && !heightInput)) return null;

  const sourceW = image.width;
  const sourceH = image.height;
  let width = widthInput ? Math.max(1, Math.round(widthInput)) : undefined;
  let height = heightInput ? Math.max(1, Math.round(heightInput)) : undefined;

  if (job.resize.lockAspect) {
    const aspect = sourceW / sourceH;
    if (width && !height) height = Math.max(1, Math.round(width / aspect));
    if (!width && height) width = Math.max(1, Math.round(height * aspect));
    if (width && height) {
      const scale = Math.min(width / sourceW, height / sourceH);
      width = Math.max(1, Math.round(sourceW * scale));
      height = Math.max(1, Math.round(sourceH * scale));
    }
  }

  width ??= sourceW;
  height ??= sourceH;
  if (width === sourceW && height === sourceH) return null;
  return { width, height };
}

function outputFileName(fileName: string, format: OutputFormat) {
  const base = fileName.replace(/\.[^.]+$/, "") || "image";
  return `${base}.squished.${extensions[format]}`;
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  if (event.data.type !== "process") return;
  const { job } = event.data;

  try {
    let image = await decode(job.buffer, job.sourceType, job.fileName);
    const target = dimensionsFor(image, job);
    if (target) {
      image = await resize(image, {
        width: target.width,
        height: target.height,
        fitMethod: "stretch",
        method: "lanczos3",
        premultiply: true,
        linearRGB: true,
      });
    }

    const encoded = await encode(image, job.format);
    const blob = new Blob([encoded], { type: mimeTypes[job.format] });
    const response: WorkerResponse = {
      type: "done",
      id: job.id,
      blob,
      width: image.width,
      height: image.height,
      originalBytes: job.buffer.byteLength,
      outputBytes: encoded.byteLength,
      outputName: outputFileName(job.fileName, job.format),
    };
    self.postMessage(response);
  } catch (error) {
    const response: WorkerResponse = {
      type: "error",
      id: job.id,
      message: error instanceof Error ? error.message : String(error),
    };
    self.postMessage(response);
  }
};

export {};
