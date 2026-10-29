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

/** Everything that can change the reason. */
export type IntakeModeEvent =
  | { type: "scan-replied"; aiOff: boolean } // the scan route answered; aiOff is ITS word
  | { type: "scan-failed" }                  // the request threw or came back not-ok
  | { type: "chose-manual" }                 // the "Enter manually" button
  | { type: "reset" };                       // booked, discarded or skipped: back to capture

/**
 * The one place a ManualReason is decided — FullIntake's reducer. The handlers
 * used to set it inline, which is how "Enter manually" came to raise the
 * server's state; a test can't see inside a handler, but it can see this.
 */
export function nextManualReason(prev: ManualReason, event: IntakeModeEvent): ManualReason {
  switch (event.type) {
    case "scan-replied": return event.aiOff ? "ai-off" : null;
    // A failure is not the kill-switch (a missing API key, a timeout). It shows
    // as a red error and leaves the form as it was.
    case "scan-failed": return prev;
    case "chose-manual": return "chosen";
    case "reset": return null;
  }
}
