import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { getPath: () => "/tmp", isPackaged: false } }));

import { CURSOR_SAMPLE_INTERVAL_MS, MAX_CURSOR_SAMPLES } from "../constants";

describe("cursor sampling", () => {
	it("tracks the cursor at 60 Hz so fast moves keep their real path and speed", () => {
		expect(1000 / CURSOR_SAMPLE_INTERVAL_MS).toBeGreaterThanOrEqual(60);
	});

	it("still holds an hour of samples", () => {
		expect(MAX_CURSOR_SAMPLES * CURSOR_SAMPLE_INTERVAL_MS).toBeGreaterThanOrEqual(
			60 * 60 * 1000 * 0.95,
		);
	});
});
