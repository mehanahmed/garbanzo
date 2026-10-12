import { ToggleButton } from "@heroui/react";
import { Button } from "@/components/ui/button";
import { MicrophoneIcon, MicrophoneSlashIcon } from "@/components/ui/icons";
import { cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAudioLevelMeter } from "@/hooks/useAudioLevelMeter";
import { AudioLevelMeter } from "@/components/ui/audio-level-meter";
import styles from "../LaunchWindow.module.css";
import "../launchTheme.css";
import type { DeviceOption } from "./launchPopoverTypes";
import { useHudInteraction } from "../contexts/HudInteractionContext";

export function DropdownItem({
	onClick,
	selected,
	icon,
	children,
	trailing,
}: {
	onClick: () => void;
	selected?: boolean;
	icon: ReactNode;
	children: ReactNode;
	trailing?: ReactNode;
}) {
	const content = (
		<>
			<span className="shrink-0">
				{isValidElement(icon)
					? cloneElement(icon as ReactElement<{ weight?: string }>, {
							weight: selected ? "fill" : "regular",
						})
					: icon}
			</span>
			<span className="truncate">{children}</span>
			{trailing}
		</>
	);
	return selected === undefined ? (
		<Button variant="ghost" className="w-full justify-start gap-3" onClick={onClick}>
			{content}
		</Button>
	) : (
		<ToggleButton
			variant="ghost"
			isSelected={selected}
			className="w-full justify-start gap-3"
			onClick={onClick}
		>
			{content}
		</ToggleButton>
	);
}

export function MicDeviceRow({
	device,
	selected,
	showLevel,
	onSelect,
}: {
	device: DeviceOption;
	selected: boolean;
	/** Only the mic that will record shows a live level, so it is obvious which one hears you. */
	showLevel: boolean;
	onSelect: () => void;
}) {
	// Opening every microphone at once just to draw meters also disturbs
	// virtual and phone mics; only the active one is opened.
	const { level } = useAudioLevelMeter({
		enabled: showLevel,
		deviceId: device.deviceId,
	});

	return (
		<ToggleButton
			variant="ghost"
			isSelected={selected}
			className="w-full justify-start gap-3"
			onClick={onSelect}
		>
			<span className="shrink-0">
				{selected ? (
					<MicrophoneIcon weight="fill" size={16} />
				) : (
					<MicrophoneSlashIcon size={16} />
				)}
			</span>
			<span className="truncate flex-1">{device.label}</span>
			{showLevel && <AudioLevelMeter level={level} className="w-16 shrink-0" />}
		</ToggleButton>
	);
}

export function HudPopover({
	open,
	onOpenChange,
	trigger,
	children,
	align = "center",
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	trigger: ReactElement;
	children: ReactNode;
	align?: "start" | "center" | "end";
}) {
	const { onMouseEnter } = useHudInteraction();
	return (
		<Popover open={open} onOpenChange={onOpenChange} modal={true}>
			<PopoverTrigger asChild>{trigger}</PopoverTrigger>
			<PopoverContent
				className={`launch-theme ${styles.menuCard} ${styles.electronNoDrag}`}
				data-hud-interactive
				unstyled
				side="top"
				align={align}
				sideOffset={8}
				avoidCollisions
				collisionPadding={10}
				usePortal={false}
				onMouseEnter={onMouseEnter}
			>
				{children}
			</PopoverContent>
		</Popover>
	);
}
