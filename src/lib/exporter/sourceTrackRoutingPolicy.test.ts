import { describe, expect, it } from "vitest";
import { resolveSourceTrackRoutingPolicy } from "./sourceTrackRoutingPolicy";

describe("resolveSourceTrackRoutingPolicy", () => {
	it("prioritizes system+mic sidecars and mutes embedded preview", () => {
		const policy = resolveSourceTrackRoutingPolicy("/tmp/recording.mp4", [
			"/tmp/recording.mp4",
			"/tmp/recording.system.wav",
			"/tmp/recording.mic.wav",
			"/tmp/recording.mixed.wav",
		]);

		expect(policy.playbackPaths).toEqual([
			"/tmp/recording.system.wav",
			"/tmp/recording.mic.wav",
		]);
		expect(policy.muteEmbeddedPreview).toBe(true);
		expect(policy.includeEmbeddedInExport).toBe(false);
	});

	it("falls back to mixed when dedicated tracks are absent", () => {
		const policy = resolveSourceTrackRoutingPolicy("/tmp/recording.mp4", [
			"/tmp/recording.mixed.wav",
		]);

		expect(policy.playbackPaths).toEqual(["/tmp/recording.mixed.wav"]);
		expect(policy.muteEmbeddedPreview).toBe(false);
		expect(policy.includeEmbeddedInExport).toBe(false);
	});

	it("keeps embedded audio when only mic sidecar is present", () => {
		const policy = resolveSourceTrackRoutingPolicy("/tmp/recording.mp4", [
			"/tmp/recording.mp4",
			"/tmp/recording.mic.wav",
		]);

		expect(policy.playbackPaths).toEqual(["/tmp/recording.mic.wav"]);
		expect(policy.muteEmbeddedPreview).toBe(false);
		expect(policy.includeEmbeddedInExport).toBe(true);
	});

	it("plays click/typing sounds as an extra track without muting the recording", () => {
		const withEmbedded = resolveSourceTrackRoutingPolicy("/tmp/recording.mp4", [
			"/tmp/recording.mp4",
			"/tmp/recording.sfx.wav",
		]);
		expect(withEmbedded.playbackPaths).toEqual(["/tmp/recording.sfx.wav"]);
		expect(withEmbedded.hasEmbeddedSourceAudio).toBe(true);
		expect(withEmbedded.muteEmbeddedPreview).toBe(false);
		expect(withEmbedded.includeEmbeddedInExport).toBe(true);

		const withSidecars = resolveSourceTrackRoutingPolicy("C:\\Rec\\recording-1.mp4", [
			"C:\\Rec\\recording-1.system.wav",
			"C:\\Rec\\recording-1.mic.wav",
			"C:\\Rec\\recording-1.sfx.wav",
		]);
		expect(withSidecars.pathsByTrack.sfx).toBe("C:\\Rec\\recording-1.sfx.wav");
		expect(withSidecars.playbackPaths).toEqual([
			"C:\\Rec\\recording-1.system.wav",
			"C:\\Rec\\recording-1.mic.wav",
			"C:\\Rec\\recording-1.sfx.wav",
		]);
		expect(withSidecars.muteEmbeddedPreview).toBe(true);
	});
});
