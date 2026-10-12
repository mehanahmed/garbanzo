import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MicDeviceRow } from "./PopoverScaffold";

const device = { deviceId: "mic-1", label: "Microphone (USB)" };

describe("microphone rows", () => {
	it("shows a live level only on the microphone that will record", () => {
		const active = renderToStaticMarkup(
			<MicDeviceRow device={device} selected showLevel onSelect={vi.fn()} />,
		);
		const other = renderToStaticMarkup(
			<MicDeviceRow device={device} selected={false} showLevel={false} onSelect={vi.fn()} />,
		);
		expect(active).toContain('aria-label="Microphone level"');
		expect(other).not.toContain('aria-label="Microphone level"');
	});
});
