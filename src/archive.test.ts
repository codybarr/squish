import { expect, test } from "bun:test";
import { unzipSync } from "fflate";
import { createArchive } from "./archive";

async function unpack(files: { name: string; blob: Blob }[]) {
	const archive = await createArchive(files);
	expect(archive.type).toBe("application/zip");
	return unzipSync(new Uint8Array(await archive.arrayBuffer()));
}

test("archives all image bytes with their output filenames", async () => {
	const entries = await unpack([
		{ name: "photo.webp", blob: new Blob([new Uint8Array([0, 255, 42])]) },
		{ name: "portrait.avif", blob: new Blob(["image bytes"]) },
	]);
	expect(Object.keys(entries)).toEqual(["photo.webp", "portrait.avif"]);
	expect(entries["photo.webp"]).toEqual(new Uint8Array([0, 255, 42]));
	expect(new TextDecoder().decode(entries["portrait.avif"])).toBe(
		"image bytes",
	);
});

test("preserves duplicates including numbered and case-insensitive collisions", async () => {
	const names = ["photo.webp", "photo.webp", "photo (2).webp", "PHOTO.webp"];
	const entries = await unpack(
		names.map((name, i) => ({ name, blob: new Blob([String(i)]) })),
	);
	expect(Object.keys(entries)).toEqual([
		"photo.webp",
		"photo (2).webp",
		"photo (2) (2).webp",
		"PHOTO (3).webp",
	]);
	expect(
		Object.values(entries).map((data) => new TextDecoder().decode(data)),
	).toEqual(["0", "1", "2", "3"]);
});

test("keeps filenames at the archive root and handles special names", async () => {
	const names = [
		"../photo.webp",
		"folder\\photo.webp",
		"__proto__",
		".",
		"..",
		"",
	];
	const entries = await unpack(
		names.map((name) => ({ name, blob: new Blob(["data"]) })),
	);
	expect(Object.keys(entries)).toEqual([
		".._photo.webp",
		"folder_photo.webp",
		"__proto__ (2)",
		". (2)",
		". (2).",
		"image",
	]);
});

test("propagates failures reading an image", async () => {
	const blob = new Blob();
	blob.arrayBuffer = async () => {
		throw new Error("read failed");
	};
	await expect(createArchive([{ name: "photo.webp", blob }])).rejects.toThrow(
		"read failed",
	);
});
