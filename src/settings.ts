export type OutputFormat = "jpg" | "png" | "webp" | "avif";

export type Settings = {
	format: OutputFormat;
	width: string;
	height: string;
	lockAspect: boolean;
};

export const SETTINGS_KEY = "squish.settings";

const defaults: Settings = {
	format: "avif",
	width: "",
	height: "",
	lockAspect: true,
};

function dimension(value: unknown): string {
	return typeof value === "string" &&
		(value === "" || (Number.isSafeInteger(Number(value)) && Number(value) > 0))
		? value
		: "";
}

export function loadSettings(storage?: Pick<Storage, "getItem">): Settings {
	try {
		const saved: unknown = JSON.parse(
			(storage ?? window.localStorage).getItem(SETTINGS_KEY) ?? "null",
		);
		if (!saved || typeof saved !== "object" || Array.isArray(saved)) {
			return { ...defaults };
		}
		const value = saved as Record<string, unknown>;
		return {
			format:
				value.format === "jpg" ||
				value.format === "png" ||
				value.format === "webp" ||
				value.format === "avif"
					? value.format
					: defaults.format,
			width: dimension(value.width),
			height: dimension(value.height),
			lockAspect:
				typeof value.lockAspect === "boolean"
					? value.lockAspect
					: defaults.lockAspect,
		};
	} catch {
		return { ...defaults };
	}
}

export function saveSettings(
	settings: Settings,
	storage?: Pick<Storage, "setItem">,
): void {
	try {
		(storage ?? window.localStorage).setItem(
			SETTINGS_KEY,
			JSON.stringify(settings),
		);
	} catch {
		// Compression should still work when storage is blocked or full.
	}
}
