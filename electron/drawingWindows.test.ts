import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
	app: { getPath: () => "/tmp", isReady: () => true, on: vi.fn() },
	BrowserWindow: { getAllWindows: () => [] },
	globalShortcut: { register: vi.fn(), unregister: vi.fn() },
	ipcMain: { handle: vi.fn(), on: vi.fn() },
}));

import {
	isDrawingOverlayOpen,
	resolveToolbarPosition,
	supportsToolbarCaptureExclusion,
} from "./drawingWindows";

const area = { x: 0, y: 0, width: 1920, height: 1040 };

describe("drawing windows", () => {
	it("places the toolbar on the right edge, vertically centred", () => {
		const position = resolveToolbarPosition(null, 470, [area], area);
		expect(position.x).toBeGreaterThan(1800);
		expect(position.y).toBe(Math.round((1040 - 470) / 2));
	});

	it("restores a saved toolbar position that is still on screen", () => {
		expect(resolveToolbarPosition({ x: 40, y: 120 }, 470, [area], area)).toEqual({
			x: 40,
			y: 120,
		});
	});

	it("ignores a saved position on a disconnected monitor", () => {
		expect(resolveToolbarPosition({ x: 2600, y: 120 }, 470, [area], area).x).toBeLessThan(1920);
	});

	it("hides the toolbar from capture on Windows and macOS only", () => {
		expect(supportsToolbarCaptureExclusion("win32")).toBe(true);
		expect(supportsToolbarCaptureExclusion("darwin")).toBe(true);
		expect(supportsToolbarCaptureExclusion("linux")).toBe(false);
	});

	it("starts closed", () => {
		expect(isDrawingOverlayOpen()).toBe(false);
	});
});
