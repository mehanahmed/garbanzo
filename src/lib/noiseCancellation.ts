/**
 * ANC (noise cancellation) mode for the microphone track.
 *
 * CamVerse keeps the microphone as a separate sidecar file next to each
 * recording (".mic.wav" / ".mic.m4a"). When ANC is on, the main process runs
 * that file through an FFmpeg cleanup chain right after recording stops:
 *
 *   - highpass / lowpass: removes rumble (fans, AC, desk bumps) and hiss
 *   - afftdn: spectral noise reduction that learns the background noise
 *   - agate (strong only): a soft gate that lowers leftover noise between words
 *
 * It is a post-process, so it costs nothing while recording, which matters on
 * low-spec PCs. Shared by the renderer and the Electron main process.
 */

export const NOISE_CANCELLATION_SETTING_KEY = "recordly.audio.noiseCancellation";

export type NoiseCancellationLevel = "off" | "light" | "strong";

export const NOISE_CANCELLATION_LEVELS: readonly NoiseCancellationLevel[] = [
	"off",
	"light",
	"strong",
];

export const NOISE_CANCELLATION_LABELS: Record<NoiseCancellationLevel, string> = {
	off: "Off",
	light: "Light – fans, hum, hiss",
	strong: "Strong – noisy rooms, traffic",
};

export function normalizeNoiseCancellationLevel(value: unknown): NoiseCancellationLevel {
	return value === "light" || value === "strong" ? value : "off";
}

export function getNoiseCancellationFilters(level: NoiseCancellationLevel): string[] {
	switch (level) {
		case "light":
			return ["highpass=f=80", "afftdn=nr=20:nf=-40:tn=1", "lowpass=f=14000"];
		case "strong":
			// One stronger spectral pass plus a soft gate. The previous double
			// pass and hard gate removed more hiss but clipped quiet syllables,
			// which sounded choppy.
			return [
				"highpass=f=90",
				"afftdn=nr=30:nf=-34:tn=1",
				"lowpass=f=12000",
				"agate=threshold=0.008:ratio=2:attack=5:release=400:range=0.2",
			];
		default:
			return [];
	}
}

type SettingsBridge = {
	getAppSetting?: (key: string) => unknown;
	setAppSetting?: (key: string, value: unknown) => boolean;
};

function getBridge(): SettingsBridge | null {
	return (globalThis as { electronAPI?: SettingsBridge }).electronAPI ?? null;
}

export function loadNoiseCancellationLevel(): NoiseCancellationLevel {
	try {
		return normalizeNoiseCancellationLevel(
			getBridge()?.getAppSetting?.(NOISE_CANCELLATION_SETTING_KEY),
		);
	} catch {
		return "off";
	}
}

export function saveNoiseCancellationLevel(level: NoiseCancellationLevel): boolean {
	try {
		return getBridge()?.setAppSetting?.(NOISE_CANCELLATION_SETTING_KEY, level) === true;
	} catch {
		return false;
	}
}
