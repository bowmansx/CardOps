/**
 * Why a card reached the review screen without AI-filled fields.
 *
 *   null      the AI scan ran and filled the form
 *   "ai-off"  the server said AI scanning is switched off (Services kill-switch)
 *   "chosen"  Beau tapped "Enter manually"
 *
 * These used to share one boolean, so choosing "Enter manually" raised the
 * amber "AI scan is off — turn it on in Services" banner even with AI on. After
 * a scan that failed for another reason (say, a missing API key), that banner
 * sent him to flip a switch that was already on.
 */
export type ManualReason = null | "ai-off" | "chosen";

/** The form was filled by hand, for whatever reason: show the grey "manual" chip. */
export const isManual = (reason: ManualReason): boolean => reason !== null;

/** Only the server can say the kill-switch is off. Only then does the banner point at Services. */
export const showAiOffBanner = (reason: ManualReason): boolean => reason === "ai-off";
