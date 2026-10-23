import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { getFfmpegBinaryPath } from "../ffmpeg/binary";
import { getNoiseCancellationCodecArgs } from "./noiseCancellation";

const execFileAsync = promisify(execFile);
const NORMALIZATION_TIMEOUT_MS = 3 * 60 * 1000;

export function buildMicNormalizationArgs(inputPath: string, outputPath: string): string[] {
	return [
		"-y",
		"-hide_banner",
		"-nostdin",
		"-nostats",
		"-i",
		inputPath,
		"-vn",
		"-ar",
		"48000",
		"-af",
		"highpass=f=80,loudnorm=I=-16:TP=-1.5:LRA=11",
		...getNoiseCancellationCodecArgs(inputPath),
		outputPath,
	];
}

export function detectAudioMaxVolume(ffmpegOutput: string): number | null {
	const match = /max_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/i.exec(ffmpegOutput);
	if (!match) {
		return null;
	}
	const val = parseFloat(match[1]);
	return Number.isFinite(val) ? val : null;
}

/**
 * Normalizes a recorded microphone audio file in place to broadcast speech loudness (-16 LUFS).
 * If the microphone was muted or silent (<= -60 dB), normalization is skipped to avoid boosting hiss.
 * If anything fails, the original file is left untouched.
 *
 * Returns true if normalization was applied, or false if skipped/failed.
 */
export async function normalizeRecordedMicAudioFile(
	micPath: string | null | undefined,
): Promise<boolean> {
	if (!micPath) {
		return false;
	}

	try {
		const stat = await fs.stat(micPath);
		if (stat.size === 0) {
			return false;
		}

		const ffmpegPath = getFfmpegBinaryPath();

		// Check max volume to detect silence or muted microphone
		try {
			const { stderr } = await execFileAsync(
				ffmpegPath,
				[
					"-hide_banner",
					"-nostdin",
					"-i",
					micPath,
					"-af",
					"volumedetect",
					"-vn",
					"-sn",
					"-dn",
					"-f",
					"null",
					"-",
				],
				{ timeout: 30000, maxBuffer: 10 * 1024 * 1024 },
			);
			const maxVol = detectAudioMaxVolume(stderr);
			if (maxVol !== null && maxVol <= -60) {
				// Muted or silent microphone, skip boosting noise floor
				return false;
			}
		} catch (volErr) {
			console.warn(
				"[mic-normalization] Failed to detect volume, proceeding with normalization:",
				volErr,
			);
		}

		const ext = path.extname(micPath);
		const tempPath = `${micPath.slice(0, micPath.length - ext.length)}.norm-tmp${ext}`;

		await execFileAsync(ffmpegPath, buildMicNormalizationArgs(micPath, tempPath), {
			timeout: NORMALIZATION_TIMEOUT_MS,
			maxBuffer: 10 * 1024 * 1024,
		});

		const normalized = await fs.stat(tempPath);
		if (normalized.size === 0) {
			throw new Error("microphone normalization produced an empty file");
		}

		await fs.rename(tempPath, micPath).catch(async () => {
			await fs.copyFile(tempPath, micPath);
			await fs.rm(tempPath, { force: true });
		});

		console.log(`[mic-normalization] Successfully normalized microphone track: ${micPath}`);
		return true;
	} catch (error) {
		console.warn("[mic-normalization] Microphone normalization skipped or failed:", error);
		return false;
	}
}
