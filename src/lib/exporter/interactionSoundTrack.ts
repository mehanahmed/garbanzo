/** File-name marker of the click/typing sound track saved next to a recording (`<video>.sfx.wav`). */
export const INTERACTION_SOUND_TRACK_MARKER = ".sfx.";

export function isInteractionSoundTrackPath(audioPath: string) {
	return audioPath.toLowerCase().includes(INTERACTION_SOUND_TRACK_MARKER);
}
