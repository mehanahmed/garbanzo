import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, globalShortcut, ipcMain, type Rectangle } from "electron";
import {
	DRAWING_SETTINGS_KEY,
	type DrawingSettings,
	type DrawingState,
	type DrawingTool,
	isDrawingMode,
	isDrawingTool,
	normalizeDrawingSettings,
} from "../src/lib/drawingTools";
import { readAppSetting, writeAppSetting } from "./appSettingsStore";
import { raiseTeleprompterWindow } from "./teleprompterWindow";

/**
 * Screen drawing while recording.
 *
 * Two windows:
 *  - the drawing layer: a transparent, full-screen window over the recorded
 *    display. It is NOT hidden from capture, so everything drawn on it is in
 *    the video. In "Mouse" mode it ignores the mouse so clicks reach the apps
 *    underneath, and it hides itself completely when there is nothing drawn.
 *  - the toolbar: a small floating window that IS hidden from capture on
 *    Windows 10 2004+ and macOS, so the tools never show up in the video.
 *
 * The drawing layer is non-activating so clicking it does not steal focus or
 * jump above the toolbar, the HUD or the teleprompter. It only takes keyboard
 * focus while the Text tool is active.
 */

const drawingDir = path.dirname(fileURLToPath(import.meta.url));
const nodeRequire = createRequire(import.meta.url);
const APP_ROOT = path.join(drawingDir, "..");
const RENDERER_DIST = path.join(APP_ROOT, "dist");
const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];

const TOOLBAR_POSITION_KEY = "recordly.drawing.toolbarPosition";
const TOOLBAR_WIDTH = 56;
const TOOLBAR_DEFAULT_HEIGHT = 470;
const TOOLBAR_EDGE_MARGIN = 20;

const SHORTCUT_TOGGLE = "CommandOrControl+Shift+D";
const SHORTCUT_UNDO = "CommandOrControl+Z";
const SHORTCUT_EXIT_DRAW = "Escape";

let overlayWindow: BrowserWindow | null = null;
let toolbarWindow: BrowserWindow | null = null;
let settings: DrawingSettings = normalizeDrawingSettings(null);
let currentTool: DrawingTool = settings.tool;
let lastDrawTool: DrawingTool = settings.tool;
let shapeCount = 0;
let drawModeShortcutsActive = false;
let overlayFocusable = false;
let getHudWindow: () => BrowserWindow | null = () => null;

function getScreen() {
	return nodeRequire("electron").screen as typeof import("electron").screen;
}

function isAlive(win: BrowserWindow | null): win is BrowserWindow {
	return Boolean(win && !win.isDestroyed());
}

export function supportsToolbarCaptureExclusion(platform: NodeJS.Platform = process.platform) {
	return platform === "win32" || platform === "darwin";
}

export function isDrawingOverlayOpen(): boolean {
	return isAlive(overlayWindow);
}

export function getDrawingState(): DrawingState {
	return { ...settings, tool: currentTool, shapeCount };
}

function loadRoute(win: BrowserWindow, windowType: string) {
	if (VITE_DEV_SERVER_URL) {
		win.loadURL(`${VITE_DEV_SERVER_URL}?windowType=${windowType}`);
	} else {
		win.loadFile(path.join(RENDERER_DIST, "index.html"), { query: { windowType } });
	}
}

function broadcast(channel: string, payload: unknown) {
	for (const win of BrowserWindow.getAllWindows()) {
		if (!win.isDestroyed()) {
			win.webContents.send(channel, payload);
		}
	}
}

function broadcastState() {
	const state = getDrawingState();
	for (const win of [overlayWindow, toolbarWindow]) {
		if (isAlive(win)) {
			win.webContents.send("drawing:state", state);
		}
	}
}

/**
 * Keep the tools, the HUD and the teleprompter above the drawing layer.
 *
 * Re-asserting "always on top" re-stacks a window without moving it.
 * (BrowserWindow.moveTop() re-applies the window's bounds on Windows, which
 * on scaled displays could shift or shrink the HUD and the toolbar so they
 * looked hidden after picking a tool.)
 */
const TOOLBAR_LEVEL = "pop-up-menu";
const HUD_LEVEL = "screen-saver";

function restack() {
	raiseTeleprompterWindow();
	const hud = getHudWindow();
	if (isAlive(hud) && hud.isVisible()) hud.setAlwaysOnTop(true, HUD_LEVEL);
	if (isAlive(toolbarWindow) && toolbarWindow.isVisible()) {
		toolbarWindow.setAlwaysOnTop(true, TOOLBAR_LEVEL);
	}
}

let restackTimer: NodeJS.Timeout | null = null;

function raiseChrome() {
	restack();
	// Windows can finish showing the drawing layer a moment later; stack again.
	if (restackTimer) clearTimeout(restackTimer);
	restackTimer = setTimeout(() => {
		restackTimer = null;
		restack();
	}, 120);
}

// ---- display + placement ---------------------------------------------------

function getTargetDisplay() {
	const screen = getScreen();
	const hud = getHudWindow();
	if (isAlive(hud)) {
		return screen.getDisplayMatching(hud.getBounds());
	}
	return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
}

export function resolveToolbarPosition(
	saved: unknown,
	toolbarHeight: number,
	workAreas: Rectangle[],
	targetWorkArea: Rectangle,
): { x: number; y: number } {
	if (
		saved &&
		typeof saved === "object" &&
		typeof (saved as { x?: unknown }).x === "number" &&
		typeof (saved as { y?: unknown }).y === "number"
	) {
		const { x, y } = saved as { x: number; y: number };
		const onScreen = workAreas.some(
			(area) =>
				x >= area.x - 8 &&
				x + TOOLBAR_WIDTH <= area.x + area.width + 8 &&
				y >= area.y - 8 &&
				y + 60 <= area.y + area.height,
		);
		if (onScreen) return { x: Math.round(x), y: Math.round(y) };
	}

	// Right edge, vertically centred: out of the way of most app content.
	return {
		x: targetWorkArea.x + targetWorkArea.width - TOOLBAR_WIDTH - TOOLBAR_EDGE_MARGIN,
		y: Math.round(targetWorkArea.y + Math.max(8, (targetWorkArea.height - toolbarHeight) / 2)),
	};
}

// ---- mode handling -----------------------------------------------------------

function registerDrawModeShortcuts(active: boolean) {
	if (active === drawModeShortcutsActive) return;
	drawModeShortcutsActive = active;
	if (active) {
		// Only while drawing: the drawing layer never takes keyboard focus, so
		// these are the way to leave drawing mode or undo without the toolbar.
		globalShortcut.register(SHORTCUT_EXIT_DRAW, () => setTool("cursor"));
		globalShortcut.register(SHORTCUT_UNDO, () => sendCommand("undo"));
	} else {
		globalShortcut.unregister(SHORTCUT_EXIT_DRAW);
		globalShortcut.unregister(SHORTCUT_UNDO);
	}
}

function applyMode() {
	const overlay = overlayWindow;
	if (!isAlive(overlay)) return;

	const drawing = isDrawingMode(currentTool);
	// The Text tool needs keyboard focus; Escape/Ctrl+Z must then reach the text box.
	const typing = currentTool === "text";
	registerDrawModeShortcuts(drawing && !typing);

	overlay.setIgnoreMouseEvents(!drawing);
	// Only touch focusability when it changes: on Windows every call also
	// deactivates the window, which hands focus to whatever sits below it.
	if (overlayFocusable !== typing) {
		overlayFocusable = typing;
		overlay.setFocusable(typing);
	}

	if (!drawing && shapeCount === 0) {
		// Nothing to show: hide the full-screen layer so it costs nothing.
		if (overlay.isVisible()) overlay.hide();
	} else if (!overlay.isVisible()) {
		overlay.showInactive();
	}

	if (typing) {
		overlay.focus();
	}
	raiseChrome();
}

function setTool(tool: DrawingTool) {
	currentTool = tool;
	if (isDrawingMode(tool)) {
		lastDrawTool = tool;
		settings = { ...settings, tool };
		persistSettings();
	}
	applyMode();
	broadcastState();
}

function toggleDrawMode() {
	setTool(isDrawingMode(currentTool) ? "cursor" : lastDrawTool);
}

function sendCommand(command: "undo" | "clear") {
	if (isAlive(overlayWindow)) {
		overlayWindow.webContents.send("drawing:command", command);
	}
}

function persistSettings() {
	try {
		writeAppSetting(DRAWING_SETTINGS_KEY, settings);
	} catch {
		// Best-effort.
	}
}

// ---- windows -----------------------------------------------------------------

function createOverlayWindow(bounds: Rectangle): BrowserWindow {
	const win = new BrowserWindow({
		...bounds,
		frame: false,
		transparent: true,
		backgroundColor: "#00000000",
		resizable: false,
		movable: false,
		minimizable: false,
		maximizable: false,
		fullscreenable: false,
		hasShadow: false,
		skipTaskbar: true,
		alwaysOnTop: true,
		focusable: false,
		show: false,
		enableLargerThanScreen: true,
		title: "Recordly drawing",
		webPreferences: {
			preload: path.join(drawingDir, "preload.mjs"),
			nodeIntegration: false,
			contextIsolation: true,
			backgroundThrottling: false,
		},
	});

	win.setAlwaysOnTop(true, "floating");
	win.setVisibleOnAllWorkspaces(true, {
		visibleOnFullScreen: true,
		skipTransformProcessType: process.platform === "darwin",
	});
	// Never content-protected: the drawings must be in the recording.

	win.once("ready-to-show", () => {
		if (isAlive(win)) {
			win.setBounds(bounds);
			applyMode();
			win.webContents.send("drawing:state", getDrawingState());
		}
	});

	win.on("closed", () => {
		if (overlayWindow === win) overlayWindow = null;
		closeDrawingSession();
	});

	loadRoute(win, "drawing-overlay");
	return win;
}

function createToolbarWindow(targetWorkArea: Rectangle): BrowserWindow {
	const screen = getScreen();
	const position = resolveToolbarPosition(
		readAppSetting(TOOLBAR_POSITION_KEY),
		TOOLBAR_DEFAULT_HEIGHT,
		screen.getAllDisplays().map((display) => display.workArea),
		targetWorkArea,
	);

	const win = new BrowserWindow({
		...position,
		width: TOOLBAR_WIDTH,
		height: TOOLBAR_DEFAULT_HEIGHT,
		frame: false,
		transparent: true,
		backgroundColor: "#00000000",
		resizable: false,
		minimizable: false,
		maximizable: false,
		fullscreenable: false,
		hasShadow: false,
		skipTaskbar: true,
		alwaysOnTop: true,
		focusable: true,
		show: false,
		title: "Drawing tools",
		webPreferences: {
			preload: path.join(drawingDir, "preload.mjs"),
			nodeIntegration: false,
			contextIsolation: true,
		},
	});

	win.setAlwaysOnTop(true, TOOLBAR_LEVEL);
	win.setVisibleOnAllWorkspaces(true, {
		visibleOnFullScreen: true,
		skipTransformProcessType: process.platform === "darwin",
	});

	if (supportsToolbarCaptureExclusion()) {
		try {
			win.setContentProtection(true);
		} catch (error) {
			console.warn("[drawing] Could not hide the drawing toolbar from capture:", error);
		}
	}

	win.once("ready-to-show", () => {
		if (isAlive(win)) {
			win.showInactive();
			win.webContents.send("drawing:state", getDrawingState());
		}
	});

	win.on("moved", () => {
		try {
			const [x, y] = win.getPosition();
			writeAppSetting(TOOLBAR_POSITION_KEY, { x, y });
		} catch {
			// Best-effort.
		}
	});

	win.on("closed", () => {
		if (toolbarWindow === win) toolbarWindow = null;
		closeDrawingSession();
	});

	loadRoute(win, "drawing-toolbar");
	return win;
}

export function openDrawingSession(): void {
	if (isAlive(overlayWindow) && isAlive(toolbarWindow)) {
		toolbarWindow.showInactive();
		raiseChrome();
		return;
	}

	settings = normalizeDrawingSettings(readAppSetting(DRAWING_SETTINGS_KEY));
	currentTool = settings.tool;
	lastDrawTool = settings.tool;
	shapeCount = 0;

	const display = getTargetDisplay();
	// The work area leaves the taskbar uncovered, so Windows never treats the
	// drawing layer as a full-screen app and hides the taskbar.
	overlayFocusable = false;
	overlayWindow = createOverlayWindow(display.workArea);
	toolbarWindow = createToolbarWindow(display.workArea);

	globalShortcut.register(SHORTCUT_TOGGLE, toggleDrawMode);
	broadcast("drawing:visibility", true);
}

export function closeDrawingSession(): void {
	registerDrawModeShortcuts(false);
	globalShortcut.unregister(SHORTCUT_TOGGLE);
	if (restackTimer) {
		clearTimeout(restackTimer);
		restackTimer = null;
	}

	const overlay = overlayWindow;
	const toolbar = toolbarWindow;
	overlayWindow = null;
	toolbarWindow = null;
	shapeCount = 0;

	if (isAlive(overlay)) overlay.close();
	if (isAlive(toolbar)) toolbar.close();
	broadcast("drawing:visibility", false);
}

export function toggleDrawingSession(): boolean {
	if (isDrawingOverlayOpen()) {
		closeDrawingSession();
		return false;
	}
	openDrawingSession();
	return true;
}

// ---- IPC ---------------------------------------------------------------------

let ipcRegistered = false;

export function registerDrawingIpc(options: { getHudWindow: () => BrowserWindow | null }): void {
	getHudWindow = options.getHudWindow;
	if (ipcRegistered) return;
	ipcRegistered = true;

	ipcMain.handle("drawing:toggle", () => (app.isReady() ? toggleDrawingSession() : false));
	ipcMain.handle("drawing:is-open", () => isDrawingOverlayOpen());
	ipcMain.handle("drawing:get-state", () => getDrawingState());

	ipcMain.on("drawing:set-tool", (_event, tool: unknown) => {
		if (isDrawingTool(tool)) setTool(tool);
	});

	ipcMain.on("drawing:set-style", (_event, style: unknown) => {
		const patch = (style && typeof style === "object" ? style : {}) as Partial<DrawingSettings>;
		const next = normalizeDrawingSettings({ ...settings, ...patch, tool: lastDrawTool });
		settings = { ...settings, color: next.color, size: next.size };
		persistSettings();
		// Picking a colour or size while in Mouse mode means "I want to draw".
		if (!isDrawingMode(currentTool)) {
			setTool(lastDrawTool);
			return;
		}
		broadcastState();
	});

	ipcMain.on("drawing:command", (_event, command: unknown) => {
		if (command === "undo" || command === "clear") sendCommand(command);
	});

	ipcMain.on("drawing:report", (_event, report: unknown) => {
		const count = (report as { shapeCount?: unknown })?.shapeCount;
		if (typeof count === "number" && Number.isFinite(count)) {
			shapeCount = Math.max(0, Math.floor(count));
			applyMode();
			broadcastState();
		}
	});

	ipcMain.on("drawing:raise-chrome", () => raiseChrome());

	ipcMain.on("drawing:toolbar-height", (_event, height: unknown) => {
		if (!isAlive(toolbarWindow) || typeof height !== "number" || !Number.isFinite(height))
			return;
		const nextHeight = Math.max(120, Math.min(900, Math.ceil(height)));
		const [x, y] = toolbarWindow.getPosition();
		const area = getScreen().getDisplayNearestPoint({ x, y }).workArea;
		// Keep the toolbar fully on screen when it grows (e.g. the colour panel opens).
		const nextY = Math.max(area.y, Math.min(y, area.y + area.height - nextHeight));
		toolbarWindow.setBounds({ x, y: nextY, width: TOOLBAR_WIDTH, height: nextHeight });
	});

	ipcMain.on("drawing:close", () => closeDrawingSession());

	app.on("will-quit", () => {
		globalShortcut.unregister(SHORTCUT_TOGGLE);
		registerDrawModeShortcuts(false);
	});
}
