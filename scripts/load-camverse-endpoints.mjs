// Load CamVerse's server settings for a desktop build.
//
// The "Deploy CamVerse services" workflow writes services/camverse-endpoints.json
// after it deploys Supabase and the share server. Repository variables with the
// same meaning win over the file. Values are written to $GITHUB_ENV (in CI) and
// printed, so the Vite build bakes them in. Only public values are handled here:
// the Supabase URL, its publishable key and the share endpoint.

import { appendFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const filePath = path.join(root, "services", "camverse-endpoints.json");

export function resolveCamverseEndpoints(env = process.env, fileText = null) {
	let file = {};
	const text = fileText ?? (existsSync(filePath) ? readFileSync(filePath, "utf8") : null);
	if (text) {
		try {
			file = JSON.parse(text) ?? {};
		} catch {
			file = {};
		}
	}
	const pick = (envValue, fileValue) => (envValue?.trim() || fileValue?.trim?.() || "").trim();
	const supabaseUrl = pick(env.CAMVERSE_SUPABASE_URL, file.supabaseUrl);
	const result = {
		VITE_SUPABASE_URL: supabaseUrl,
		VITE_SUPABASE_PUBLISHABLE_KEY: pick(
			env.CAMVERSE_SUPABASE_PUBLISHABLE_KEY,
			file.supabasePublishableKey,
		),
		VITE_CLOUD_SHARE_ENDPOINT: pick(env.CAMVERSE_SHARE_ENDPOINT, file.shareEndpoint),
		VITE_AUTH_SOCIAL_PROVIDERS: pick(env.CAMVERSE_AUTH_SOCIAL_PROVIDERS, file.socialProviders),
	};
	for (const key of ["VITE_SUPABASE_URL", "VITE_CLOUD_SHARE_ENDPOINT"]) {
		if (result[key] && !/^https:\/\//.test(result[key])) {
			throw new Error(`${key} must start with https:// (got ${result[key]})`);
		}
	}
	return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const values = resolveCamverseEndpoints();
	const lines = Object.entries(values).map(([key, value]) => `${key}=${value}`);
	if (process.env.GITHUB_ENV) {
		appendFileSync(process.env.GITHUB_ENV, `${lines.join("\n")}\n`);
	}
	const accounts = values.VITE_SUPABASE_URL && values.VITE_SUPABASE_PUBLISHABLE_KEY;
	console.log(
		`[camverse] Sign-in and Feedback: ${accounts ? "on" : "off (no Supabase settings)"}; ` +
			`share links: ${accounts && values.VITE_CLOUD_SHARE_ENDPOINT ? "on" : "off"}`,
	);
	for (const [key, value] of Object.entries(values)) {
		console.log(`  ${key}=${value || "(not set)"}`);
	}
}
