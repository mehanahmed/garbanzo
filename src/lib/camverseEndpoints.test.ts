import { describe, expect, it } from "vitest";
// @ts-expect-error - plain .mjs build script without type declarations
import { resolveCamverseEndpoints } from "../../scripts/load-camverse-endpoints.mjs";

const deployed = JSON.stringify({
	supabaseUrl: "https://abcdefghijklmnopqrst.supabase.co",
	supabasePublishableKey: "sb_publishable_example",
	shareEndpoint: "https://camverse-share.example.workers.dev/api/upload",
	socialProviders: "google",
});

describe("CamVerse server settings for builds", () => {
	it("reads the addresses saved by the deploy workflow", () => {
		expect(resolveCamverseEndpoints({}, deployed)).toEqual({
			VITE_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
			VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_example",
			VITE_CLOUD_SHARE_ENDPOINT: "https://camverse-share.example.workers.dev/api/upload",
			VITE_AUTH_SOCIAL_PROVIDERS: "google",
		});
	});

	it("lets repository variables override the saved file", () => {
		const values = resolveCamverseEndpoints(
			{ CAMVERSE_SHARE_ENDPOINT: "https://share.camverse.example/api/upload" },
			deployed,
		);
		expect(values.VITE_CLOUD_SHARE_ENDPOINT).toBe("https://share.camverse.example/api/upload");
	});

	it("turns everything off when nothing is configured", () => {
		const values = resolveCamverseEndpoints({}, "");
		expect(Object.values(values).every((value) => value === "")).toBe(true);
	});

	it("rejects non-HTTPS server addresses", () => {
		expect(() =>
			resolveCamverseEndpoints({ CAMVERSE_SUPABASE_URL: "http://insecure.example" }, ""),
		).toThrow(/https/);
	});
});
