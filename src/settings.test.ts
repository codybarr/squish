import { expect, test } from "bun:test";
import {
	loadSettings,
	SETTINGS_KEY,
	type Settings,
	saveSettings,
} from "./settings";

const defaults: Settings = {
	format: "avif",
	width: "",
	height: "",
	lockAspect: true,
};
const from = (value: unknown) =>
	loadSettings({ getItem: () => JSON.stringify(value) });

test("uses defaults for missing or malformed settings", () => {
	expect(loadSettings({ getItem: () => null })).toEqual(defaults);
	expect(loadSettings({ getItem: () => "{" })).toEqual(defaults);
	for (const value of [null, [], "avif", 42]) {
		expect(from(value)).toEqual(defaults);
	}
});

test("all settings survive saving and reloading, including unlocked aspect ratio", () => {
	let stored = "";
	const settings: Settings = {
		format: "webp",
		width: "1280",
		height: "720",
		lockAspect: false,
	};
	saveSettings(settings, {
		setItem(key, value) {
			expect(key).toBe(SETTINGS_KEY);
			stored = value;
		},
	});
	expect(loadSettings({ getItem: () => stored })).toEqual(settings);
});

test("restores each format and blank automatic dimensions", () => {
	for (const format of ["jpg", "png", "webp", "avif"] as const) {
		expect(from({ ...defaults, format })).toEqual({ ...defaults, format });
	}
});

test("invalid fields fall back independently without losing valid preferences", () => {
	expect(
		from({ format: "gif", width: "-10", height: "720", lockAspect: false }),
	).toEqual({ ...defaults, height: "720", lockAspect: false });
	for (const width of [
		10,
		null,
		"NaN",
		"Infinity",
		"1.5",
		"0",
		" ",
		"9007199254740992",
	]) {
		expect(from({ width }).width).toBe("");
	}
	expect(from({ lockAspect: "false" }).lockAspect).toBe(true);
});

test("unavailable storage does not break loading or saving", () => {
	expect(
		loadSettings({
			getItem() {
				throw new Error("blocked");
			},
		}),
	).toEqual(defaults);
	expect(() =>
		saveSettings(defaults, {
			setItem() {
				throw new Error("full");
			},
		}),
	).not.toThrow();
});
