// Mouse-click and typing sounds for a recording.
//
// During recording the interaction hook notes when the mouse is pressed and
// released and when a key goes down (never which key). When the recording is
// saved, those moments are rendered into `<video>.sfx.wav` next to the video.
// The editor treats that file as its own source audio track, so the sounds
// follow trims, speed changes and clip edits exactly like the microphone, and
// can be turned down or off in the editor.
//
// The sounds are synthesized here (no sample files), with a few variations
// each so fast typing doesn't sound like a machine gun.

import fs from "node:fs/promises";
import type { CursorTelemetryPoint } from "../types";

export const INTERACTION_SOUND_SAMPLE_RATE = 24_000;
export const INTERACTION_SOUND_TRACK_SUFFIX = ".sfx.wav";

const TAIL_MS = 400;
const BLOCK_FRAMES = INTERACTION_SOUND_SAMPLE_RATE * 10;

export type InteractionSoundKind = "click" | "release" | "key";

export interface InteractionSoundEvent {
	timeMs: number;
	kind: InteractionSoundKind;
}

export function getInteractionSoundTrackPath(videoPath: string) {
	return `${videoPath.replace(/\.[^./\\]+$/u, "")}${INTERACTION_SOUND_TRACK_SUFFIX}`;
}

export function getInteractionSoundEvents(
	samples: ReadonlyArray<Pick<CursorTelemetryPoint, "timeMs" | "interactionType">>,
): InteractionSoundEvent[] {
	const events: InteractionSoundEvent[] = [];
	for (const sample of samples) {
		if (!Number.isFinite(sample.timeMs) || sample.timeMs < 0) continue;
		switch (sample.interactionType) {
			case "click":
			case "double-click":
			case "right-click":
			case "middle-click":
				events.push({ timeMs: sample.timeMs, kind: "click" });
				break;
			case "mouseup":
				events.push({ timeMs: sample.timeMs, kind: "release" });
				break;
			case "keypress":
				events.push({ timeMs: sample.timeMs, kind: "key" });
				break;
			default:
				break;
		}
	}
	return events.sort((a, b) => a.timeMs - b.timeMs);
}

// ---------------------------------------------------------------------------
// Synthesis

function mulberry32(seed: number) {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

type Biquad = { b0: number; b1: number; b2: number; a1: number; a2: number };

function bandpass(frequency: number, q: number): Biquad {
	const w0 = (2 * Math.PI * frequency) / INTERACTION_SOUND_SAMPLE_RATE;
	const alpha = Math.sin(w0) / (2 * q);
	const a0 = 1 + alpha;
	return {
		b0: alpha / a0,
		b1: 0,
		b2: -alpha / a0,
		a1: (-2 * Math.cos(w0)) / a0,
		a2: (1 - alpha) / a0,
	};
}

function highpass(frequency: number, q: number): Biquad {
	const w0 = (2 * Math.PI * frequency) / INTERACTION_SOUND_SAMPLE_RATE;
	const alpha = Math.sin(w0) / (2 * q);
	const cos = Math.cos(w0);
	const a0 = 1 + alpha;
	return {
		b0: (1 + cos) / 2 / a0,
		b1: -(1 + cos) / a0,
		b2: (1 + cos) / 2 / a0,
		a1: (-2 * cos) / a0,
		a2: (1 - alpha) / a0,
	};
}

function filter(input: Float32Array, f: Biquad): Float32Array {
	const out = new Float32Array(input.length);
	let x1 = 0;
	let x2 = 0;
	let y1 = 0;
	let y2 = 0;
	for (let i = 0; i < input.length; i++) {
		const x0 = input[i];
		const y0 = f.b0 * x0 + f.b1 * x1 + f.b2 * x2 - f.a1 * y1 - f.a2 * y2;
		out[i] = y0;
		x2 = x1;
		x1 = x0;
		y2 = y1;
		y1 = y0;
	}
	return out;
}

function decayingNoise(length: number, tauSec: number, random: () => number) {
	const out = new Float32Array(length);
	for (let i = 0; i < length; i++) {
		out[i] = (random() * 2 - 1) * Math.exp(-i / INTERACTION_SOUND_SAMPLE_RATE / tauSec);
	}
	return out;
}

function addTone(
	target: Float32Array,
	frequency: number,
	tauSec: number,
	amplitude: number,
	pitchDrop = 0,
) {
	let phase = 0;
	for (let i = 0; i < target.length; i++) {
		const t = i / INTERACTION_SOUND_SAMPLE_RATE;
		// A little downward pitch glide makes taps sound physical, not electronic.
		const f = frequency * (1 + pitchDrop * Math.exp(-t / 0.004));
		phase += (2 * Math.PI * f) / INTERACTION_SOUND_SAMPLE_RATE;
		target[i] += Math.sin(phase) * Math.exp(-t / tauSec) * amplitude;
	}
}

function mix(target: Float32Array, source: Float32Array, gain: number) {
	for (let i = 0; i < target.length; i++) target[i] += source[i] * gain;
}

function finish(sound: Float32Array, peak: number) {
	// 0.25 ms fade-in and a fade-out over the last 15% avoid clicks at the edges.
	const fadeIn = Math.max(1, Math.round(INTERACTION_SOUND_SAMPLE_RATE * 0.00025));
	const fadeOutStart = Math.floor(sound.length * 0.85);
	let max = 0;
	for (let i = 0; i < sound.length; i++) {
		if (i < fadeIn) sound[i] *= i / fadeIn;
		if (i >= fadeOutStart) sound[i] *= 1 - (i - fadeOutStart) / (sound.length - fadeOutStart);
		max = Math.max(max, Math.abs(sound[i]));
	}
	const scale = max > 0 ? peak / max : 0;
	for (let i = 0; i < sound.length; i++) sound[i] *= scale;
	return sound;
}

function framesFor(seconds: number) {
	return Math.round(seconds * INTERACTION_SOUND_SAMPLE_RATE);
}

/** A crisp mouse-button "tick": bright transient plus a short plastic ring. */
function synthMouseDown(variant: number) {
	const random = mulberry32(1000 + variant);
	const detune = 1 + (random() - 0.5) * 0.08;
	const sound = new Float32Array(framesFor(0.035));
	mix(sound, filter(decayingNoise(sound.length, 0.0009, random), highpass(2400, 0.7)), 1);
	addTone(sound, 3100 * detune, 0.0035, 0.45, 0.05);
	addTone(sound, 880 * detune, 0.005, 0.18, 0.1);
	return finish(sound, 0.34);
}

/** The softer, slightly higher click when the button comes back up. */
function synthMouseUp(variant: number) {
	const random = mulberry32(2000 + variant);
	const detune = 1 + (random() - 0.5) * 0.08;
	const sound = new Float32Array(framesFor(0.025));
	mix(sound, filter(decayingNoise(sound.length, 0.0006, random), highpass(3000, 0.7)), 1);
	addTone(sound, 3600 * detune, 0.0025, 0.4, 0.04);
	addTone(sound, 1050 * detune, 0.005, 0.2, 0.08);
	return finish(sound, 0.16);
}

/** A keyboard key: a short clack on top of a soft low "thock". */
function synthKey(variant: number) {
	const random = mulberry32(3000 + variant);
	const pitch = 1 + (random() - 0.5) * 0.24;
	const sound = new Float32Array(framesFor(0.06));
	mix(
		sound,
		filter(decayingNoise(sound.length, 0.0016, random), bandpass(3600 * pitch, 1.1)),
		1.3,
	);
	mix(sound, filter(decayingNoise(sound.length, 0.004, random), bandpass(1400 * pitch, 2)), 0.35);
	addTone(sound, 210 * pitch, 0.011, 0.55, 0.35);
	addTone(sound, 1250 * pitch, 0.005, 0.22, 0.1);
	return finish(sound, 0.24);
}

let soundBank: Record<InteractionSoundKind, Float32Array[]> | null = null;

export function getInteractionSoundBank() {
	if (!soundBank) {
		soundBank = {
			click: [0, 1, 2].map(synthMouseDown),
			release: [0, 1, 2].map(synthMouseUp),
			key: [0, 1, 2, 3, 4, 5, 6, 7].map(synthKey),
		};
	}
	return soundBank;
}

function pickVariant(index: number, count: number) {
	// Deterministic, so re-rendering a recording gives the same result.
	const random = mulberry32(index * 7919 + 17);
	return Math.floor(random() * count) % count;
}

function eventGain(event: InteractionSoundEvent, index: number) {
	if (event.kind !== "key") return 1;
	// Real typing is uneven; vary loudness a little per key.
	return 0.82 + mulberry32(index * 104729 + 3)() * 0.3;
}

// ---------------------------------------------------------------------------
// WAV output

function wavHeader(frameCount: number) {
	const dataBytes = frameCount * 2;
	const header = Buffer.alloc(44);
	header.write("RIFF", 0, "ascii");
	header.writeUInt32LE(36 + dataBytes, 4);
	header.write("WAVE", 8, "ascii");
	header.write("fmt ", 12, "ascii");
	header.writeUInt32LE(16, 16);
	header.writeUInt16LE(1, 20); // PCM
	header.writeUInt16LE(1, 22); // mono
	header.writeUInt32LE(INTERACTION_SOUND_SAMPLE_RATE, 24);
	header.writeUInt32LE(INTERACTION_SOUND_SAMPLE_RATE * 2, 28);
	header.writeUInt16LE(2, 32);
	header.writeUInt16LE(16, 34);
	header.write("data", 36, "ascii");
	header.writeUInt32LE(dataBytes, 40);
	return header;
}

/**
 * Render the sound track block by block (10 s at a time), so even an hour-long
 * recording needs well under 1 MB of memory on low-RAM PCs.
 */
export function* renderInteractionSoundBlocks(
	events: InteractionSoundEvent[],
	totalFrames: number,
): Generator<Buffer> {
	const bank = getInteractionSoundBank();
	const placed = events.map((event, index) => {
		const variants = bank[event.kind];
		return {
			start: Math.round((event.timeMs / 1000) * INTERACTION_SOUND_SAMPLE_RATE),
			sound: variants[pickVariant(index, variants.length)],
			gain: eventGain(event, index),
		};
	});

	let first = 0;
	for (let blockStart = 0; blockStart < totalFrames; blockStart += BLOCK_FRAMES) {
		const blockLength = Math.min(BLOCK_FRAMES, totalFrames - blockStart);
		const blockEnd = blockStart + blockLength;
		const mixBuffer = new Float32Array(blockLength);

		while (
			first < placed.length &&
			placed[first].start + placed[first].sound.length <= blockStart
		) {
			first++;
		}
		for (let i = first; i < placed.length && placed[i].start < blockEnd; i++) {
			const { start, sound, gain } = placed[i];
			const from = Math.max(start, blockStart);
			const to = Math.min(start + sound.length, blockEnd);
			for (let frame = from; frame < to; frame++) {
				mixBuffer[frame - blockStart] += sound[frame - start] * gain;
			}
		}

		const pcm = Buffer.alloc(blockLength * 2);
		for (let i = 0; i < blockLength; i++) {
			const value = Math.max(-1, Math.min(1, mixBuffer[i]));
			pcm.writeInt16LE(Math.round(value * 32767), i * 2);
		}
		yield pcm;
	}
}

/**
 * Write (or remove) the click/typing sound track for a recording.
 * Returns the file path, or null when the recording has no clicks or key presses.
 */
export async function writeInteractionSoundTrack(
	videoPath: string,
	samples: ReadonlyArray<Pick<CursorTelemetryPoint, "timeMs" | "interactionType">>,
): Promise<string | null> {
	const trackPath = getInteractionSoundTrackPath(videoPath);
	const events = getInteractionSoundEvents(samples);
	if (events.length === 0) {
		await fs.rm(trackPath, { force: true });
		return null;
	}

	let lastTimeMs = 0;
	for (const sample of samples) {
		if (Number.isFinite(sample.timeMs)) lastTimeMs = Math.max(lastTimeMs, sample.timeMs);
	}
	const totalFrames = Math.ceil(((lastTimeMs + TAIL_MS) / 1000) * INTERACTION_SOUND_SAMPLE_RATE);

	const tempPath = `${trackPath}.tmp`;
	const handle = await fs.open(tempPath, "w");
	try {
		await handle.write(wavHeader(totalFrames));
		for (const block of renderInteractionSoundBlocks(events, totalFrames)) {
			await handle.write(block);
		}
	} finally {
		await handle.close();
	}
	await fs.rename(tempPath, trackPath);
	return trackPath;
}
