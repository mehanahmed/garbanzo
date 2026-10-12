import { describe, expect, it } from "vitest";
import { getNoiseCancellationFilters } from "./noiseCancellation";

describe("noise cancellation strength", () => {
	it("keeps Strong to a single spectral pass with a soft gate (no choppy voice)", () => {
		const strong = getNoiseCancellationFilters("strong");
		expect(strong.filter((filter) => filter.startsWith("afftdn"))).toHaveLength(1);
		const gate = strong.find((filter) => filter.startsWith("agate"));
		expect(gate).toBeDefined();
		const range = Number(/range=([0-9.]+)/.exec(gate ?? "")?.[1]);
		// The gate never pulls quiet speech down by more than ~14 dB.
		expect(range).toBeGreaterThanOrEqual(0.2);
	});
});
