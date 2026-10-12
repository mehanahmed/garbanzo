import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	getInteractionSoundBank,
	getInteractionSoundEvents,
	getInteractionSoundTrackPath,
	INTERACTION_SOUND_SAMPLE_RATE,
	writeInteractionSoundTrack,
} from "./interactionSounds";

const tempDirs: string[] = [];

afterEach(async () => {
	await Promise.all(
		tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
	);
});

async function makeVideoPath() {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "camverse-sfx-"));
	tempDirs.push(dir);
	return path.join(dir, "recording-1.mp4");
}

function readPcm(buffer: Buffer) {
	const samples = new Int16Array((buffer.length - 44) / 2);
	for (let i = 0; i < samples.length; i++) samples[i] = buffer.readInt16LE(44 + i * 2);
	return samples;
}

function peakBetween(samples: Int16Array, startMs: number, endMs: number) {
	const from = Math.floor((startMs / 1000) * INTERACTION_SOUND_SAMPLE_RATE);
	const to = Math.min(samples.length, Math.ceil((endMs / 1000) * INTERACTION_SOUND_SAMPLE_RATE));
	let peak = 0;
	for (let i = from; i < to; i++) peak = Math.max(peak, Math.abs(samples[i]));
	return peak / 32767;
}

describe("interaction sounds", () => {
	it("places the track next to the video", () => {
		expect(getInteractionSoundTrackPath("C:\\Rec\\recording-1.mp4")).toBe(
			"C:\\Rec\\recording-1.sfx.wav",
		);
		expect(getInteractionSoundTrackPath("/rec/my.video.webm")).toBe("/rec/my.video.sfx.wav");
	});

	it("turns clicks, releases and key presses into sound events, ignoring moves", () => {
		expect(
			getInteractionSoundEvents([
				{ timeMs: 500, interactionType: "keypress" },
				{ timeMs: 100, interactionType: "click" },
				{ timeMs: 150, interactionType: "move" },
				{ timeMs: 180, interactionType: "mouseup" },
				{ timeMs: 300, interactionType: "double-click" },
				{ timeMs: 400, interactionType: "right-click" },
				{ timeMs: 450 },
			]),
		).toEqual([
			{ timeMs: 100, kind: "click" },
			{ timeMs: 180, kind: "release" },
			{ timeMs: 300, kind: "click" },
			{ timeMs: 400, kind: "click" },
			{ timeMs: 500, kind: "key" },
		]);
	});

	it("synthesizes short, non-clipping sounds", () => {
		const bank = getInteractionSoundBank();
		for (const [kind, variants] of Object.entries(bank)) {
			expect(variants.length).toBeGreaterThan(1);
			for (const sound of variants) {
				const peak = sound.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
				expect(peak, kind).toBeGreaterThan(0.1);
				expect(peak, kind).toBeLessThan(0.5);
				expect(sound.length / INTERACTION_SOUND_SAMPLE_RATE).toBeLessThanOrEqual(0.07);
				// Fades in and out, so no pop at either edge.
				expect(Math.abs(sound[0])).toBeLessThan(0.01);
				expect(Math.abs(sound[sound.length - 1])).toBeLessThan(0.01);
			}
		}
	});

	it("writes a WAV with sound exactly where the clicks and keys happened", async () => {
		const videoPath = await makeVideoPath();
		const trackPath = await writeInteractionSoundTrack(videoPath, [
			{ timeMs: 0, interactionType: "move" },
			{ timeMs: 1000, interactionType: "click" },
			{ timeMs: 1080, interactionType: "mouseup" },
			{ timeMs: 2500, interactionType: "keypress" },
			{ timeMs: 2620, interactionType: "keypress" },
			{ timeMs: 9990, interactionType: "keypress" },
			{ timeMs: 10_010, interactionType: "keypress" },
			{ timeMs: 12_000, interactionType: "move" },
		]);

		expect(trackPath).toBe(getInteractionSoundTrackPath(videoPath));
		const wav = await fs.readFile(trackPath as string);
		expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
		expect(wav.toString("ascii", 8, 12)).toBe("WAVE");
		expect(wav.readUInt32LE(24)).toBe(INTERACTION_SOUND_SAMPLE_RATE);
		expect(wav.readUInt32LE(40)).toBe(wav.length - 44);

		const pcm = readPcm(wav);
		// Lasts until the last telemetry sample plus a short tail.
		expect(pcm.length / INTERACTION_SOUND_SAMPLE_RATE).toBeCloseTo(12.4, 2);

		expect(peakBetween(pcm, 0, 995)).toBe(0);
		expect(peakBetween(pcm, 1000, 1040)).toBeGreaterThan(0.25);
		expect(peakBetween(pcm, 1080, 1110)).toBeGreaterThan(0.08);
		expect(peakBetween(pcm, 1150, 2495)).toBe(0);
		expect(peakBetween(pcm, 2500, 2560)).toBeGreaterThan(0.12);
		expect(peakBetween(pcm, 2620, 2680)).toBeGreaterThan(0.12);
		// Sounds that straddle the internal 10-second block boundary stay whole.
		expect(peakBetween(pcm, 9990, 10_000)).toBeGreaterThan(0.1);
		expect(peakBetween(pcm, 10_000, 10_070)).toBeGreaterThan(0.1);
		expect(peakBetween(pcm, 10_100, 12_400)).toBe(0);
		await expect(fs.access(`${trackPath}.tmp`)).rejects.toThrow();
	});

	it("removes a stale track when there is nothing to play", async () => {
		const videoPath = await makeVideoPath();
		const trackPath = getInteractionSoundTrackPath(videoPath);
		await fs.writeFile(trackPath, "old");

		await expect(
			writeInteractionSoundTrack(videoPath, [{ timeMs: 0, interactionType: "move" }]),
		).resolves.toBeNull();
		await expect(fs.access(trackPath)).rejects.toThrow();
	});
});
