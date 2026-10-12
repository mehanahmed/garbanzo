import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, ipcMain, type Rectangle } from "electron";
import { readAppSetting, writeAppSetting } from "./appSettingsStore";

/**
 * Teleprompter: a floating, always-on-top script window.
 *
 * It is excluded from screen capture (setContentProtection) on Windows 10
 * 2004+ and macOS, so the script never shows up in the recording even when it
 * sits on top of the recorded screen. Linux has no capture exclusion, so there
 * it should be kept off the recorded display.
 */

const teleprompterDir = path.dirname(fileURLToPath(import.meta.url));
const nodeRequire = createRequire(import.meta.url);
const APP_ROOT = path.join(teleprompterDir, "..");
const RENDERER_DIST = path.join(APP_ROOT, "dist");
const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];

const BOUNDS_SETTING_KEY = "recordly.teleprompter.bounds";
const DEFAULT_WIDTH = 760;
const DEFAULT_HEIGHT = 300;
const MIN_WIDTH = 380;
const MIN_HEIGHT = 200;

let teleprompterWindow: BrowserWindow | null = null;
let recordingActive = false;

export function supportsTeleprompterCaptureExclusion(platform: NodeJS.Platform = process.platform) {
	return platform === "win32" || platform === "darwin";
}

function getScreen() {
	return nodeRequire("electron").screen as typeof import("electron").screen;
}

function isValidBounds(value: unknown): value is Rectangle {
	if (!value || typeof value !== "object") return false;
	const b = value as Record<string, unknown>;
	return ["x", "y", "width", "height"].every(
		(key) => typeof b[key] === "number" && Number.isFinite(b[key] as number),
	);
}

/** Restore the last position if it is still on a connected display, else top-centre. */
export function resolveTeleprompterBounds(
	saved: unknown,
	workAreas: Rectangle[],
	primaryWorkArea: Rectangle,
): Rectangle {
	if (isValidBounds(saved)) {
		const visible = workAreas.some(
			(area) =>
				saved.x + 40 < area.x + area.width &&
				saved.x + saved.width - 40 > area.x &&
				saved.y >= area.y - 8 &&
				saved.y + 40 < area.y + area.height,
		);
		if (visible) {
			return {
				x: Math.round(saved.x),
				y: Math.round(saved.y),
				width: Math.max(MIN_WIDTH, Math.round(saved.width)),
				height: Math.max(MIN_HEIGHT, Math.round(saved.height)),
			};
		}
	}

	// Top-centre, just under the webcam, so the presenter's eyes stay near the lens.
	const width = Math.min(DEFAULT_WIDTH, primaryWorkArea.width - 32);
	return {
		x: Math.round(primaryWorkArea.x + (primaryWorkArea.width - width) / 2),
		y: primaryWorkArea.y + 16,
		width,
		height: DEFAULT_HEIGHT,
	};
}

function broadcastVisibility() {
	const open = isTeleprompterOpen();
	for (const win of BrowserWindow.getAllWindows()) {
		if (!win.isDestroyed()) {
			win.webContents.send("teleprompter:visibility", open);
		}
	}
}

function saveBounds(win: BrowserWindow) {
	try {
		if (!win.isDestroyed()) {
			writeAppSetting(BOUNDS_SETTING_KEY, win.getBounds());
		}
	} catch {
		// Position memory is best-effort.
	}
}

export function isTeleprompterOpen(): boolean {
	return Boolean(teleprompterWindow && !teleprompterWindow.isDestroyed());
}

export function createTeleprompterWindow(): BrowserWindow {
	if (teleprompterWindow && !teleprompterWindow.isDestroyed()) {
		teleprompterWindow.show();
		teleprompterWindow.focus();
		return teleprompterWindow;
	}

	const screen = getScreen();
	const bounds = resolveTeleprompterBounds(
		readAppSetting(BOUNDS_SETTING_KEY),
		screen.getAllDisplays().map((display) => display.workArea),
		screen.getPrimaryDisplay().workArea,
	);

	const win = new BrowserWindow({
		...bounds,
		minWidth: MIN_WIDTH,
		minHeight: MIN_HEIGHT,
		frame: false,
		// An opaque window is much cheaper to composite than a transparent one
		// on low-spec GPUs; the UI draws its own rounded dark panel.
		transparent: false,
		backgroundColor: "#0c0c10",
		resizable: true,
		alwaysOnTop: true,
		skipTaskbar: false,
		hasShadow: true,
		show: false,
		title: "Teleprompter",
		webPreferences: {
			preload: path.join(teleprompterDir, "preload.mjs"),
			nodeIntegration: false,
			contextIsolation: true,
			backgroundThrottling: false,
		},
	});

	teleprompterWindow = win;
	win.setAlwaysOnTop(true, "floating");
	win.setVisibleOnAllWorkspaces(true, {
		visibleOnFullScreen: true,
		skipTransformProcessType: process.platform === "darwin",
	});

	if (supportsTeleprompterCaptureExclusion()) {
		try {
			win.setContentProtection(true);
		} catch (error) {
			console.warn("[teleprompter] Could not hide the teleprompter from capture:", error);
		}
	}

	win.once("ready-to-show", () => {
		if (!win.isDestroyed()) {
			win.show();
			win.webContents.send("teleprompter:recording-state", recordingActive);
		}
	});

	win.on("moved", () => saveBounds(win));
	win.on("resized", () => saveBounds(win));
	win.on("close", () => saveBounds(win));
	win.on("closed", () => {
		if (teleprompterWindow === win) {
			teleprompterWindow = null;
		}
		broadcastVisibility();
	});

	if (VITE_DEV_SERVER_URL) {
		win.loadURL(`${VITE_DEV_SERVER_URL}?windowType=teleprompter`);
	} else {
		win.loadFile(path.join(RENDERER_DIST, "index.html"), {
			query: { windowType: "teleprompter" },
		});
	}

	broadcastVisibility();
	return win;
}

export function closeTeleprompterWindow(): void {
	if (teleprompterWindow && !teleprompterWindow.isDestroyed()) {
		teleprompterWindow.close();
	}
}

export function toggleTeleprompterWindow(): boolean {
	if (isTeleprompterOpen()) {
		closeTeleprompterWindow();
		return false;
	}
	createTeleprompterWindow();
	return true;
}

/** Keep the teleprompter above the screen-drawing layer. */
export function raiseTeleprompterWindow(): void {
	if (teleprompterWindow && !teleprompterWindow.isDestroyed() && teleprompterWindow.isVisible()) {
		teleprompterWindow.moveTop();
	}
}

/** Called whenever a recording starts or stops so the script can auto-scroll. */
export function notifyTeleprompterRecordingState(active: boolean): void {
	recordingActive = active;
	if (teleprompterWindow && !teleprompterWindow.isDestroyed()) {
		teleprompterWindow.webContents.send("teleprompter:recording-state", active);
	}
}

let ipcRegistered = false;

export function registerTeleprompterIpc(): void {
	if (ipcRegistered) return;
	ipcRegistered = true;

	ipcMain.handle("teleprompter:toggle", () => {
		if (!app.isReady()) return false;
		return toggleTeleprompterWindow();
	});
	ipcMain.handle("teleprompter:is-open", () => isTeleprompterOpen());
	ipcMain.handle("teleprompter:get-recording-state", () => recordingActive);
	ipcMain.handle("teleprompter:get-platform-info", () => ({
		captureExclusionSupported: supportsTeleprompterCaptureExclusion(),
	}));
	ipcMain.on("teleprompter:close", () => closeTeleprompterWindow());
	ipcMain.on("teleprompter:minimize", () => teleprompterWindow?.minimize());
}
