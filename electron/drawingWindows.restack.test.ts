import { beforeEach, describe, expect, it, vi } from "vitest";

type Handler = (...args: unknown[]) => void;

class FakeWindow {
	static created: FakeWindow[] = [];
	options: Record<string, unknown>;
	calls: string[] = [];
	visible = false;
	destroyed = false;
	listeners = new Map<string, Handler[]>();
	webContents = { send: vi.fn() };

	constructor(options: Record<string, unknown> = {}) {
		this.options = options;
		FakeWindow.created.push(this);
	}
	static getAllWindows() {
		return FakeWindow.created.filter((win) => !win.destroyed);
	}
	private record(name: string, ...args: unknown[]) {
		this.calls.push(
			args.length ? `${name}(${args.map((a) => JSON.stringify(a)).join(",")})` : name,
		);
	}
	on(event: string, handler: Handler) {
		this.listeners.set(event, [...(this.listeners.get(event) ?? []), handler]);
		return this;
	}
	once(event: string, handler: Handler) {
		return this.on(event, handler);
	}
	emit(event: string) {
		for (const handler of this.listeners.get(event) ?? []) handler();
	}
	isDestroyed() {
		return this.destroyed;
	}
	isVisible() {
		return this.visible;
	}
	show() {
		this.visible = true;
		this.record("show");
	}
	showInactive() {
		this.visible = true;
		this.record("showInactive");
	}
	hide() {
		this.visible = false;
		this.record("hide");
	}
	close() {
		this.destroyed = true;
		this.emit("closed");
	}
	focus() {
		this.record("focus");
	}
	moveTop() {
		this.record("moveTop");
	}
	setBounds(bounds: unknown) {
		this.record("setBounds", bounds);
	}
	getBounds() {
		return { x: 0, y: 0, width: 800, height: 60 };
	}
	getPosition() {
		return [1840, 300];
	}
	setAlwaysOnTop(...args: unknown[]) {
		this.record("setAlwaysOnTop", ...args);
	}
	setVisibleOnAllWorkspaces() {}
	setContentProtection() {}
	setIgnoreMouseEvents(...args: unknown[]) {
		this.record("setIgnoreMouseEvents", ...args);
	}
	setFocusable(...args: unknown[]) {
		this.record("setFocusable", ...args);
	}
	loadURL() {}
	loadFile() {}
}

const ipcHandlers = new Map<string, Handler>();
const display = {
	bounds: { x: 0, y: 0, width: 1920, height: 1080 },
	workArea: { x: 0, y: 0, width: 1920, height: 1040 },
};

vi.mock("electron", () => ({
	app: { getPath: () => "/tmp", isReady: () => true, on: vi.fn() },
	BrowserWindow: FakeWindow,
	globalShortcut: { register: vi.fn(() => true), unregister: vi.fn() },
	ipcMain: {
		handle: vi.fn((channel: string, handler: Handler) => ipcHandlers.set(channel, handler)),
		on: vi.fn((channel: string, handler: Handler) => ipcHandlers.set(channel, handler)),
	},
}));

vi.mock("node:module", () => ({
	createRequire: () => () => ({
		screen: {
			getDisplayMatching: () => display,
			getDisplayNearestPoint: () => display,
			getCursorScreenPoint: () => ({ x: 10, y: 10 }),
			getAllDisplays: () => [display],
		},
	}),
}));

vi.mock("./appSettingsStore", () => ({
	readAppSetting: () => null,
	writeAppSetting: vi.fn(),
}));

const { openDrawingSession, closeDrawingSession, registerDrawingIpc } = await import(
	"./drawingWindows"
);

describe("drawing toolbar stacking", () => {
	let hud: FakeWindow;

	beforeEach(() => {
		closeDrawingSession();
		FakeWindow.created = [];
		hud = new FakeWindow({ title: "hud" });
		hud.visible = true;
		registerDrawingIpc({ getHudWindow: () => hud as never });
		openDrawingSession();
		for (const win of FakeWindow.created) win.emit("ready-to-show");
	});

	const overlay = () => FakeWindow.created.find((w) => w.options.title === "CamVerse drawing");
	const toolbar = () => FakeWindow.created.find((w) => w.options.title === "Drawing tools");

	it("covers the work area, not the taskbar", () => {
		expect(overlay()?.options).toMatchObject(display.workArea);
	});

	it("keeps the HUD and toolbar on top without moving or resizing them when a tool is picked", () => {
		hud.calls = [];
		const bar = toolbar();
		if (!bar) throw new Error("toolbar missing");
		bar.calls = [];

		for (const tool of ["arrow", "rect", "cursor", "pen", "highlighter"]) {
			ipcHandlers.get("drawing:set-tool")?.({}, tool);
		}

		for (const win of [hud, bar]) {
			expect(win.calls.some((call) => call.startsWith("moveTop"))).toBe(false);
			expect(win.calls.some((call) => call.startsWith("setBounds"))).toBe(false);
			expect(win.calls.some((call) => call.startsWith("hide"))).toBe(false);
			expect(win.calls.some((call) => call.startsWith("setAlwaysOnTop(true"))).toBe(true);
		}
		expect(bar.visible).toBe(true);
		expect(hud.visible).toBe(true);
	});

	it("only changes the drawing layer's focusability for the Text tool", () => {
		const layer = overlay();
		if (!layer) throw new Error("overlay missing");
		layer.calls = [];
		for (const tool of ["arrow", "rect", "pen"]) {
			ipcHandlers.get("drawing:set-tool")?.({}, tool);
		}
		expect(layer.calls.filter((call) => call.startsWith("setFocusable"))).toHaveLength(0);
		ipcHandlers.get("drawing:set-tool")?.({}, "text");
		ipcHandlers.get("drawing:set-tool")?.({}, "pen");
		expect(layer.calls.filter((call) => call.startsWith("setFocusable"))).toEqual([
			"setFocusable(true)",
			"setFocusable(false)",
		]);
	});
});
