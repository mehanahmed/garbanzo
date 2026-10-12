import { useCallback, useEffect, useRef, useState } from "react";
import { BRAND } from "@/lib/brand";
import type { User } from "@supabase/supabase-js";
import { loadAppSetting, saveAppSetting } from "@/lib/appSettings";
import { RecordlySignInDialog } from "./RecordlySignInDialog";

const SEEN_KEY = "recordly.onboarding.v1.seen";

export function OnboardingController({
	requestNonce,
	ready,
	user,
	configured,
	callbackError,
}: {
	requestNonce: number;
	ready: boolean;
	user: User | null;
	configured: boolean;
	callbackError?: string;
}) {
	const [open, setOpen] = useState(false);
	const checked = useRef(false);
	useEffect(() => {
		if (requestNonce > 0) setOpen(true);
	}, [requestNonce]);
	const close = useCallback(() => {
		saveAppSetting(SEEN_KEY, true);
		setOpen(false);
	}, []);

	useEffect(() => {
		if (!BRAND.accountsEnabled) return;
		if (!ready || checked.current) return;
		checked.current = true;
		if (!loadAppSetting<boolean>(SEEN_KEY)) setOpen(true);
	}, [ready]);

	// CamVerse has no accounts yet, so the sign-in onboarding is not shown.
	if (!BRAND.accountsEnabled) return null;

	return (
		<RecordlySignInDialog
			onboarding
			variant="wide"
			open={open}
			onOpenChange={(value) => {
				if (!value) close();
			}}
			user={user}
			configured={configured}
			callbackError={callbackError}
			onAuthenticated={close}
		/>
	);
}
