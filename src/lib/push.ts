import webpush from "web-push";

/**
 * Server-only web push sender (Phase 4 alert engine). Reads the VAPID keypair
 * from env; silently a no-op when unconfigured so callers can degrade.
 */

export type StoredSubscription = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

export function pushConfigured(): boolean {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

let configured = false;
function ensureConfigured() {
  if (configured) return;
  webpush.setVapidDetails(
    "mailto:bowmansx@gmail.com",
    process.env.VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!,
  );
  configured = true;
}

/**
 * Send one payload to every subscription. Returns endpoints that came back
 * 404/410 (expired/unsubscribed) so the caller can prune them.
 */
export async function sendToAll(
  subs: StoredSubscription[],
  payload: { title: string; body: string; url?: string },
): Promise<{ sent: number; stale: string[] }> {
  if (!pushConfigured() || subs.length === 0) return { sent: 0, stale: [] };
  ensureConfigured();
  const stale: string[] = [];
  let sent = 0;
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: s.keys },
          JSON.stringify(payload),
        );
        sent++;
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) stale.push(s.endpoint);
        // other failures: drop silently — next run retries
      }
    }),
  );
  return { sent, stale };
}
