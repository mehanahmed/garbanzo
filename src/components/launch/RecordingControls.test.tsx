import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/contexts/I18nContext";
import { RecordingControls } from "./RecordingControls";

function render(props: { drawingOpen?: boolean; teleprompterOpen?: boolean } = {}) {
	return renderToStaticMarkup(
		<I18nProvider>
			<RecordingControls
				onHome={vi.fn()}
				paused={false}
				microphoneEnabled
				elapsed={6}
				onPauseResume={vi.fn()}
				onStopRecording={vi.fn()}
				onHideHud={vi.fn()}
				onCancelRecording={vi.fn()}
				formatTime={(seconds) => `00:0${seconds}`}
				drawingOpen={props.drawingOpen ?? false}
				onToggleDrawing={vi.fn()}
				teleprompterOpen={props.teleprompterOpen ?? false}
				onToggleTeleprompter={vi.fn()}
			/>
		</I18nProvider>,
	);
}

describe("recording controls", () => {
	it("offers screen drawing and the teleprompter while recording", () => {
		const html = render();
		expect(html).toContain('aria-label="Draw on screen"');
		expect(html).toContain('aria-label="Open teleprompter"');
	});

	it("shows when drawing and the teleprompter are open", () => {
		const html = render({ drawingOpen: true, teleprompterOpen: true });
		expect(html).toContain('aria-label="Close screen drawing"');
		expect(html).toContain('aria-label="Close teleprompter"');
	});
});
