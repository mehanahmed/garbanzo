import { beforeEach, describe, expect, it, vi } from "vitest";

const telemetry = vi.hoisted(() => ({
	now: 0,
	paused: false,
	pushCursorSample: vi.fn(),
}));

vi.mock("electron", () => ({
	app: { getPath: vi.fn(() => "/tmp"), setPath: vi.fn(), isReady: vi.fn(() => true) },
}));

vi.mock("../state", async (importOriginal) => ({
	...(await importOriginal<typeof import("../state")>()),
	isCursorCaptureActive: true,
}));

vi.mock("./telemetry", () => ({
	getCursorCaptureElapsedMs: () => telemetry.now,
	getHookCursorScreenPoint: vi.fn(),
	getNormalizedCursorPoint: () => ({ cx: 0.25, cy: 0.75 }),
	isCursorCapturePaused: () => telemetry.paused,
	pushCursorSample: telemetry.pushCursorSample,
}));

import { recordKeyDown, recordKeyUp, resetKeyboardInteractionState } from "./interaction";

function pressedTimes() {
	return telemetry.pushCursorSample.mock.calls.map((call) => call[2]);
}

describe("typing capture for click/typing sounds", () => {
	beforeEach(() => {
		telemetry.now = 0;
		telemetry.paused = false;
		telemetry.pushCursorSample.mockClear();
		resetKeyboardInteractionState();
	});

	it("stores only the time of each key press, never the key", () => {
		telemetry.now = 1200;
		recordKeyDown(30);
		expect(telemetry.pushCursorSample).toHaveBeenCalledWith(0.25, 0.75, 1200, "keypress");
		expect(JSON.stringify(telemetry.pushCursorSample.mock.calls)).not.toContain("30");
	});

	it("makes one sound for a held key, and another after it is released", () => {
		telemetry.now = 100;
		recordKeyDown(30);
		telemetry.now = 600;
		recordKeyDown(30); // auto-repeat
		telemetry.now = 650;
		recordKeyDown(30);
		recordKeyUp(30);
		telemetry.now = 900;
		recordKeyDown(30);
		expect(pressedTimes()).toEqual([100, 900]);
	});

	it("ignores modifier keys on their own and keys pressed while paused", () => {
		telemetry.now = 100;
		recordKeyDown(29); // Ctrl
		recordKeyDown(42); // Shift
		telemetry.now = 200;
		recordKeyDown(31); // S
		telemetry.paused = true;
		telemetry.now = 400;
		recordKeyDown(32);
		expect(pressedTimes()).toEqual([200]);
	});
});
