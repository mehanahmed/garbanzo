import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
	app: { getPath: () => os.tmpdir(), isPackaged: false, getAppPath: () => process.cwd() },
}));

let simulatedVolumedetectStderr = "max_volume: -24.5 dB\nmean_volume: -28.0 dB";
const execFileMock = vi.fn();
vi.mock("node:child_process", () => ({
	execFile: (...args: unknown[]) => {
		const callback = args[args.length - 1];
		if (typeof callback === "function") {
			execFileMock(...args.slice(0, -1));
			const cmdArgs = args[1] as string[];
			if (cmdArgs?.includes("volumedetect")) {
				callback(null, { stdout: "", stderr: simulatedVolumedetectStderr });
			} else {
				// Create the output file if output path is passed
				const outputPath = cmdArgs?.[cmdArgs.length - 1];
				if (
					outputPath &&
					typeof outputPath === "string" &&
					outputPath.includes("norm-tmp")
				) {
					try {
						fsSync.writeFileSync(outputPath, Buffer.alloc(1024, 2));
					} catch {
						// ignore
					}
				}
				callback(null, { stdout: "", stderr: "" });
			}
		}
	},
}));

import {
	buildMicNormalizationArgs,
	detectAudioMaxVolume,
	normalizeRecordedMicAudioFile,
} from "./micNormalization";

describe("microphone normalization", () => {
	it("builds ffmpeg arguments targeting -16 LUFS speech loudness with 48kHz audio", () => {
		const args = buildMicNormalizationArgs("/tmp/in.mic.wav", "/tmp/out.mic.wav");
		expect(args).toContain("-af");
		const filterIndex = args.indexOf("-af");
		const filterString = args[filterIndex + 1];
		expect(filterString).toContain("loudnorm=I=-16:TP=-1.5:LRA=11");
		expect(filterString).toContain("highpass=f=80");
		expect(args).toContain("-ar");
		expect(args[args.indexOf("-ar") + 1]).toBe("48000");
		expect(args.at(-1)).toBe("/tmp/out.mic.wav");
	});

	it("preserves container codec formats for m4a and wav", () => {
		const wavArgs = buildMicNormalizationArgs("in.mic.wav", "out.mic.wav");
		expect(wavArgs).toContain("pcm_s16le");

		const m4aArgs = buildMicNormalizationArgs("in.mic.m4a", "out.mic.m4a");
		expect(m4aArgs).toContain("aac");
	});

	it("detects max volume from ffmpeg volumedetect output", () => {
		const output = `
[Parsed_volumedetect_0 @ 000001] n_samples: 48000
[Parsed_volumedetect_0 @ 000001] mean_volume: -29.5 dB
[Parsed_volumedetect_0 @ 000001] max_volume: -26.5 dB
		`;
		expect(detectAudioMaxVolume(output)).toBe(-26.5);
	});

	it("returns null for max volume when output is invalid", () => {
		expect(detectAudioMaxVolume("")).toBeNull();
		expect(detectAudioMaxVolume("no volume info here")).toBeNull();
	});

	it("leaves non-existent or null mic paths untouched", async () => {
		await expect(normalizeRecordedMicAudioFile(null)).resolves.toBe(false);
		await expect(normalizeRecordedMicAudioFile("/definitely/missing.mic.wav")).resolves.toBe(
			false,
		);
	});

	it("skips normalization when microphone is silent or muted (<= -60 dB)", async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "mic-norm-silent-test-"));
		const testMicPath = path.join(tempDir, "silent.mic.wav");
		await fs.writeFile(testMicPath, Buffer.alloc(1024, 0));

		simulatedVolumedetectStderr = "max_volume: -75.0 dB\nmean_volume: -80.0 dB";
		try {
			const result = await normalizeRecordedMicAudioFile(testMicPath);
			expect(result).toBe(false);
		} finally {
			simulatedVolumedetectStderr = "max_volume: -24.5 dB\nmean_volume: -28.0 dB";
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	});

	it("normalizes existing mic audio files when audio signal is detected", async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "mic-norm-test-"));
		const testMicPath = path.join(tempDir, "sample.mic.wav");
		await fs.writeFile(testMicPath, Buffer.alloc(1024, 1));

		try {
			const result = await normalizeRecordedMicAudioFile(testMicPath);
			expect(result).toBe(true);
			expect(execFileMock).toHaveBeenCalled();
		} finally {
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	});
});
