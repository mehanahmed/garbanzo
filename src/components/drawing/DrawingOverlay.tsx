import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_DRAWING_SETTINGS, type DrawingState, isDrawingMode } from "@/lib/drawingTools";
import styles from "./Drawing.module.css";
import {
	appendPoint,
	isMeaningfulShape,
	type Point,
	renderShape,
	type Shape,
	sizeCanvas,
	snapAngle,
	snapSquare,
	strokeWidthFor,
	TEXT_FONT_FAMILY,
	textSizeFor,
} from "./drawingModel";

const INITIAL_STATE: DrawingState = { ...DEFAULT_DRAWING_SETTINGS, shapeCount: 0 };

type TextDraft = { at: Point; color: string; fontSize: number };

/**
 * The full-screen drawing layer. Committed shapes live on one canvas, the
 * shape being drawn on a second one, so a long session never redraws
 * everything on every mouse move (important on low-spec PCs).
 */
export function DrawingOverlay() {
	const [state, setState] = useState<DrawingState>(INITIAL_STATE);
	const [textDraft, setTextDraft] = useState<TextDraft | null>(null);
	const baseRef = useRef<HTMLCanvasElement>(null);
	const liveRef = useRef<HTMLCanvasElement>(null);
	const textRef = useRef<HTMLTextAreaElement>(null);
	const shapesRef = useRef<Shape[]>([]);
	const activeRef = useRef<Shape | null>(null);
	const originRef = useRef<Point | null>(null);
	const frameRef = useRef(0);
	const stateRef = useRef(state);
	stateRef.current = state;
	const textDraftRef = useRef<TextDraft | null>(null);
	textDraftRef.current = textDraft;

	const report = useCallback(() => {
		window.electronAPI?.reportDrawing?.({ shapeCount: shapesRef.current.length });
	}, []);

	const redrawBase = useCallback(() => {
		const canvas = baseRef.current;
		const ctx = canvas?.getContext("2d");
		if (!canvas || !ctx) return;
		ctx.save();
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		ctx.restore();
		for (const shape of shapesRef.current) renderShape(ctx, shape);
	}, []);

	const clearLive = useCallback(() => {
		const canvas = liveRef.current;
		const ctx = canvas?.getContext("2d");
		if (!canvas || !ctx) return;
		ctx.save();
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		ctx.restore();
	}, []);

	const commit = useCallback(
		(shape: Shape) => {
			if (!isMeaningfulShape(shape)) return;
			shapesRef.current.push(shape);
			const ctx = baseRef.current?.getContext("2d");
			if (ctx) renderShape(ctx, shape);
			report();
		},
		[report],
	);

	// ---- sizing ------------------------------------------------------------
	useEffect(() => {
		const resize = () => {
			const width = window.innerWidth;
			const height = window.innerHeight;
			if (baseRef.current) sizeCanvas(baseRef.current, width, height);
			if (liveRef.current) sizeCanvas(liveRef.current, width, height);
			redrawBase();
		};
		resize();
		window.addEventListener("resize", resize);
		return () => window.removeEventListener("resize", resize);
	}, [redrawBase]);

	// ---- text --------------------------------------------------------------
	const commitText = useCallback(() => {
		const draft = textDraftRef.current;
		const value = textRef.current?.value ?? "";
		if (draft && value.trim()) {
			commit({
				kind: "text",
				color: draft.color,
				fontSize: draft.fontSize,
				at: draft.at,
				text: value,
			});
		}
		setTextDraft(null);
	}, [commit]);

	useEffect(() => {
		if (textDraft) {
			requestAnimationFrame(() => textRef.current?.focus());
		}
	}, [textDraft]);

	// ---- state + commands from the main process ----------------------------
	useEffect(() => {
		const api = window.electronAPI;
		if (!api) return;
		void api.getDrawingState?.().then((next) => {
			if (!next) return;
			stateRef.current = next;
			setState(next);
		});
		const offState = api.onDrawingState?.((next) => {
			// Update the ref now: a click can arrive before React re-renders.
			stateRef.current = next;
			setState(next);
			// Leaving the Text tool keeps whatever was typed.
			if (next.tool !== "text" && textDraftRef.current) commitText();
		});
		const offCommand = api.onDrawingCommand?.((command) => {
			if (textDraftRef.current) {
				setTextDraft(null);
				return;
			}
			if (command === "undo") shapesRef.current.pop();
			if (command === "clear") shapesRef.current = [];
			redrawBase();
			report();
		});
		return () => {
			offState?.();
			offCommand?.();
		};
	}, [commitText, redrawBase, report]);

	// ---- pointer drawing ---------------------------------------------------
	const drawLive = useCallback(() => {
		frameRef.current = 0;
		const shape = activeRef.current;
		const ctx = liveRef.current?.getContext("2d");
		if (!shape || !ctx) return;
		clearLive();
		renderShape(ctx, shape);
	}, [clearLive]);

	const scheduleLive = useCallback(() => {
		if (!frameRef.current) frameRef.current = requestAnimationFrame(drawLive);
	}, [drawLive]);

	const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
		const current = stateRef.current;
		if (!isDrawingMode(current.tool) || event.button !== 0) return;
		const point = { x: event.clientX, y: event.clientY };

		if (current.tool === "text") {
			if (textDraftRef.current) {
				commitText();
				return;
			}
			setTextDraft({ at: point, color: current.color, fontSize: textSizeFor(current) });
			return;
		}

		const width = strokeWidthFor(current);
		const tool = current.tool;
		if (tool === "pen" || tool === "highlighter") {
			activeRef.current = { kind: tool, color: current.color, width, points: [point] };
		} else if (tool === "line" || tool === "arrow" || tool === "rect") {
			activeRef.current = { kind: tool, color: current.color, width, from: point, to: point };
		} else {
			return;
		}
		event.currentTarget.setPointerCapture(event.pointerId);
		originRef.current = point;
		scheduleLive();
	};

	const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
		const shape = activeRef.current;
		const origin = originRef.current;
		if (!shape || !origin) return;

		const samples = event.nativeEvent.getCoalescedEvents?.() ?? [];
		const points = samples.length > 0 ? samples : [event.nativeEvent];

		if (shape.kind === "pen" || shape.kind === "highlighter") {
			let changed = false;
			for (const sample of points) {
				changed =
					appendPoint(shape.points, { x: sample.clientX, y: sample.clientY }) || changed;
			}
			if (changed) scheduleLive();
			return;
		}

		if (shape.kind !== "line" && shape.kind !== "arrow" && shape.kind !== "rect") return;
		const raw = { x: event.clientX, y: event.clientY };
		shape.to = event.shiftKey
			? shape.kind === "rect"
				? snapSquare(origin, raw)
				: snapAngle(origin, raw)
			: raw;
		scheduleLive();
	};

	const finishStroke = () => {
		const shape = activeRef.current;
		activeRef.current = null;
		originRef.current = null;
		if (frameRef.current) {
			cancelAnimationFrame(frameRef.current);
			frameRef.current = 0;
		}
		clearLive();
		if (shape) commit(shape);
		window.electronAPI?.raiseDrawingChrome?.();
	};

	const toolClass = isDrawingMode(state.tool) ? styles[`tool_${state.tool}`] : styles.passthrough;

	return (
		<div
			className={`${styles.overlay} ${toolClass ?? ""}`}
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={finishStroke}
			onPointerCancel={finishStroke}
		>
			<canvas ref={baseRef} className={styles.canvas} />
			<canvas ref={liveRef} className={styles.canvas} />
			{textDraft && (
				<textarea
					ref={textRef}
					className={styles.textDraft}
					rows={1}
					spellCheck={false}
					aria-label="Text annotation"
					style={{
						left: textDraft.at.x,
						top: textDraft.at.y,
						color: textDraft.color,
						fontSize: textDraft.fontSize,
						fontFamily: TEXT_FONT_FAMILY,
						lineHeight: 1.2,
					}}
					onPointerDown={(event) => event.stopPropagation()}
					onInput={(event) => {
						const el = event.currentTarget;
						el.style.height = "auto";
						el.style.height = `${el.scrollHeight}px`;
						el.style.width = "auto";
						el.style.width = `${Math.max(40, el.scrollWidth + 8)}px`;
					}}
					onKeyDown={(event) => {
						if (event.key === "Enter" && !event.shiftKey) {
							event.preventDefault();
							commitText();
						} else if (event.key === "Escape") {
							event.preventDefault();
							setTextDraft(null);
						}
					}}
					onBlur={commitText}
				/>
			)}
		</div>
	);
}

export default DrawingOverlay;
