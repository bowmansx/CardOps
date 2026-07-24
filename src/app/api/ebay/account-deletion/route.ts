import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

// eBay Marketplace Account Deletion endpoint (connector plan §2 Phase 1.1).
// eBay refuses to activate a production keyset until this exists and answers
// its challenge. Single-homed on the MasterOps domain — register EXACTLY
//   https://<master-ops domain>/api/ebay/account-deletion
// plus the EBAY_VERIFICATION_TOKEN env value in the developer portal.

function endpointUrl(req: Request): string {
  const h = new Headers(req.headers);
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}/api/ebay/account-deletion`;
}

// Challenge: respond with sha256hex(challengeCode + verificationToken + endpointURL).
export async function GET(req: Request) {
  const token = process.env.EBAY_VERIFICATION_TOKEN;
  if (!token) return NextResponse.json({ error: "EBAY_VERIFICATION_TOKEN not set." }, { status: 503 });
  const challenge = new URL(req.url).searchParams.get("challenge_code");
  if (!challenge) return NextResponse.json({ error: "challenge_code required." }, { status: 400 });
  const challengeResponse = createHash("sha256")
    .update(challenge + token + endpointUrl(req))
    .digest("hex");
  return NextResponse.json({ challengeResponse });
}

// Deletion notices: acknowledge fast (200) and log. CardOps stores no eBay
// buyer data today, so there is nothing to purge — the log proves receipt.
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const svc = createServiceClient();
  if (svc) {
    try {
      await svc.from("audit_log").insert({
        actor: "ebay",
        action: "account_deletion_notice",
        target: "ebay",
        payload: { notification: body?.notification?.notificationId ?? null },
        result: "ok",
      });
    } catch {}
  }
  return NextResponse.json({ ok: true });
}
