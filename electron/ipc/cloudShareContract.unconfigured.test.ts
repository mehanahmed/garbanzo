import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
	delete process.env.VITE_CLOUD_SHARE_ENDPOINT;
});

const { normalizeCloudEndpoint } = await import("./cloudShareContract");

describe("cloud share without a configured CamVerse server", () => {
	it("never uploads to Recordly's server", () => {
		expect(() => normalizeCloudEndpoint("https://videos.recordly.dev/api/upload")).toThrow(
			"only allowed through the CamVerse service",
		);
	});

	it("still allows a local development server", () => {
		expect(normalizeCloudEndpoint("http://localhost:8787/api/upload")).toBe(
			"http://localhost:8787/api/upload",
		);
	});
});
