import { type Zippable, zip } from "fflate";

export async function createArchive(
	files: { name: string; blob: Blob }[],
): Promise<Blob> {
	const entries: Zippable = Object.create(null);
	const used = new Set<string>();
	for (const file of files) {
		// Keep every image at the archive root, with a unique filename.
		const base = file.name.replace(/[\\/]/g, "_") || "image";
		const dot = base.lastIndexOf(".");
		const stem = dot > 0 ? base.slice(0, dot) : base;
		const extension = dot > 0 ? base.slice(dot) : "";
		let name = base;
		let suffix = 2;
		while (
			used.has(name.toLowerCase()) ||
			name === "." ||
			name === ".." ||
			name === "__proto__"
		) {
			name = `${stem} (${suffix++})${extension}`;
		}
		used.add(name.toLowerCase());
		entries[name] = new Uint8Array(await file.blob.arrayBuffer());
	}
	return new Promise((resolve, reject) => {
		// Images are already compressed; store them without recompressing.
		zip(entries, { level: 0 }, (error, data) => {
			if (error) reject(error);
			else
				resolve(new Blob([new Uint8Array(data)], { type: "application/zip" }));
		});
	});
}
