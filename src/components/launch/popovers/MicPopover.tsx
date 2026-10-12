import {
	MicrophoneSlashIcon,
	SoundwaveIcon,
	SpeakerHighIcon,
	SpeakerXIcon,
} from "@/components/ui/icons";
import { useScopedT } from "@/contexts/I18nContext";
import { DropdownItem, HudPopover, MicDeviceRow } from "./PopoverScaffold";
import { useLaunchPopoverCoordinator } from "./LaunchPopoverCoordinator";
import type { DeviceOption } from "./launchPopoverTypes";
import { type ReactElement, useState } from "react";
import {
	loadNoiseCancellationLevel,
	NOISE_CANCELLATION_LABELS,
	NOISE_CANCELLATION_LEVELS,
	type NoiseCancellationLevel,
	saveNoiseCancellationLevel,
} from "@/lib/noiseCancellation";
import styles from "../LaunchWindow.module.css";

const POPOVER_ID = "mic";

export function MicPopover({
	trigger,
	disabled,
	systemAudioEnabled,
	onToggleSystemAudio,
	microphoneEnabled,
	onDisableMicrophone,
	devices,
	microphoneDeviceId,
	selectedDeviceId,
	onSelectDevice,
}: {
	trigger: ReactElement;
	disabled?: boolean;
	systemAudioEnabled: boolean;
	onToggleSystemAudio: () => void;
	microphoneEnabled: boolean;
	onDisableMicrophone: () => void;
	devices: DeviceOption[];
	microphoneDeviceId?: string;
	selectedDeviceId?: string;
	onSelectDevice: (deviceId: string) => void;
}) {
	const t = useScopedT("launch");
	const { isOpen, requestOpen, requestClose } = useLaunchPopoverCoordinator();
	const open = isOpen(POPOVER_ID);
	// The one microphone that will be recorded.
	const activeDeviceId = selectedDeviceId ?? microphoneDeviceId ?? "default";
	const [ancLevel, setAncLevel] = useState<NoiseCancellationLevel>(loadNoiseCancellationLevel);

	return (
		<HudPopover
			open={open}
			onOpenChange={(nextOpen) => {
				if (!nextOpen) {
					requestClose(POPOVER_ID);
					return;
				}
				if (disabled) {
					return;
				}
				requestOpen(POPOVER_ID);
			}}
			trigger={trigger}
			align="start"
		>
			<div className={styles.ddLabel}>{t("recording.microphone")}</div>
			<DropdownItem
				icon={
					systemAudioEnabled ? <SpeakerHighIcon size={16} /> : <SpeakerXIcon size={16} />
				}
				selected={systemAudioEnabled}
				onClick={onToggleSystemAudio}
			>
				{systemAudioEnabled
					? t("recording.disableSystemAudio")
					: t("recording.enableSystemAudio")}
			</DropdownItem>
			{microphoneEnabled && (
				<DropdownItem
					icon={<MicrophoneSlashIcon size={16} />}
					onClick={() => {
						onDisableMicrophone();
						requestClose(POPOVER_ID);
					}}
				>
					{t("recording.turnOffMicrophone")}
				</DropdownItem>
			)}
			{!microphoneEnabled && (
				<div className="px-3 py-2 text-xs text-[var(--launch-text-muted)]">
					{t("recording.selectMicToEnable")}
				</div>
			)}
			{devices.map((device) => (
				<MicDeviceRow
					key={device.deviceId}
					device={device}
					selected={microphoneEnabled && activeDeviceId === device.deviceId}
					showLevel={open && microphoneEnabled && activeDeviceId === device.deviceId}
					onSelect={() => onSelectDevice(device.deviceId)}
				/>
			))}
			{devices.length === 0 && (
				<div className="text-center text-xs text-[var(--launch-text-muted)] py-4">
					{t("recording.noMicrophonesFound")}
				</div>
			)}
			{microphoneEnabled && (
				<>
					<div className={styles.ddLabel}>Noise cancellation (ANC)</div>
					{NOISE_CANCELLATION_LEVELS.map((level) => (
						<DropdownItem
							key={level}
							icon={<SoundwaveIcon size={16} />}
							selected={ancLevel === level}
							onClick={() => {
								setAncLevel(level);
								saveNoiseCancellationLevel(level);
							}}
						>
							{NOISE_CANCELLATION_LABELS[level]}
						</DropdownItem>
					))}
					<div className="px-3 pb-2 text-[11px] leading-snug text-[var(--launch-text-muted)]">
						Cleans the mic track right after you stop recording.
					</div>
				</>
			)}
		</HudPopover>
	);
}
