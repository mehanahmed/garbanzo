/**
 * CamVerse branding and feature switches.
 *
 * CamVerse is based on Recordly (https://github.com/webadderallorg/Recordly),
 * licensed under AGPL-3.0. That credit must stay visible in the app and the
 * source must stay available (see LICENSE.md).
 *
 * Recordly's online services (accounts, share links, news cards) belong to the
 * Recordly project, so they are switched off in CamVerse until CamVerse has
 * its own.
 */
export const BRAND = {
	name: "CamVerse",
	editorName: "CamVerse Editor",
	basedOn: "Recordly",
	basedOnUrl: "https://github.com/webadderallorg/Recordly",
	sourceUrl: "https://github.com/princeshiamofficial/garbanzo",
	issuesUrl: "https://github.com/princeshiamofficial/garbanzo/issues",
	license: "AGPL-3.0",
	/** Sign-in and accounts (Recordly's Supabase project). */
	accountsEnabled: false,
	/** "Publish as link" uploads to Recordly's video server. */
	cloudShareEnabled: false,
	/** Dashboard news cards fetched from Recordly's repository. */
	announcementsEnabled: false,
	/** Community chat link. */
	communityUrl: null as string | null,
} as const;

export const APP_ICON_PATH = "app-icons/camverse";
