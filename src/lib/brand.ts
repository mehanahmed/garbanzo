/**
 * CamVerse branding and feature switches.
 *
 * CamVerse is based on Recordly (https://github.com/webadderallorg/Recordly),
 * licensed under AGPL-3.0. That credit must stay visible in the app and the
 * source must stay available (see LICENSE.md).
 *
 * Accounts, Feedback and share links run on CamVerse's own Supabase project
 * and share server. Builds without those settings simply hide the features.
 * Recordly's news feed is never used.
 */
type SocialProvider = "google" | "azure" | "github";

// Filled in at build time from CamVerse's own servers (see CAMVERSE_SERVER_SETUP.md).
// Keep the literal import.meta.env.VITE_* form: Vite only replaces that exact text.
const SUPABASE_READY = Boolean(
	import.meta.env.VITE_SUPABASE_URL?.trim() &&
		import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim(),
);
const SHARE_ENDPOINT: string = import.meta.env.VITE_CLOUD_SHARE_ENDPOINT?.trim() ?? "";
const SOCIAL_PROVIDERS = (import.meta.env.VITE_AUTH_SOCIAL_PROVIDERS ?? "")
	.split(",")
	.map((value: string) => value.trim().toLowerCase())
	.filter(
		(value: string): value is SocialProvider =>
			value === "google" || value === "azure" || value === "github",
	);

export const BRAND = {
	name: "CamVerse",
	editorName: "CamVerse Editor",
	basedOn: "Recordly",
	basedOnUrl: "https://github.com/webadderallorg/Recordly",
	sourceUrl: "https://github.com/princeshiamofficial/garbanzo",
	issuesUrl: "https://github.com/princeshiamofficial/garbanzo/issues",
	license: "AGPL-3.0",
	/** Sign-in, accounts and Feedback: on when the build has CamVerse's Supabase settings. */
	accountsEnabled: SUPABASE_READY,
	/** "Publish as link" and the Shared library: on when CamVerse's share server is configured too. */
	cloudShareEnabled: SUPABASE_READY && SHARE_ENDPOINT.length > 0,
	/** Dashboard news cards fetched from Recordly's repository. */
	announcementsEnabled: false,
	/** Community chat link. */
	communityUrl: null as string | null,
	/** Social sign-in buttons that are set up in Supabase (google, azure, github). */
	socialProviders: SOCIAL_PROVIDERS,
} as const;

export const APP_ICON_PATH = "app-icons/camverse";
