// Scan a cost receipt (Beau, 2026-07-21). Photograph a receipt → Claude Vision
// pulls amount / vendor / date to prefill the allocate form, and stores the image
// (private receipts bucket) for the record. Owner-only, AI kill-switch gated,
// cheap Haiku. No booking here — the user still classifies + saves it.
import { NextResponse } from "next/server";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { randomUUID } from "node:crypto";
import { anthropic, HAIKU_MODEL } from "@/lib/anthropic";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { currentRole } from "@/lib/cards/roles";
import { coerceDate } from "@/lib/books/date";

export const dynamic = "force-dynamic";
export const maxDuration = 45;

const Schema = z.object({
  vendor: z.string().describe("the store/vendor name, best guess"),
  date: z.string().describe("YYYY-MM-DD from the receipt, else today"),
  total: z.number().describe("grand total paid, positive"),
});

// ~10.5 MB of base64 ≈ 8 MB binary — the client downscales to well under this, so
// anything larger is a misuse; reject before decoding/forwarding it.
const MAX_B64 = 14_000_000;

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if ((await currentRole()) !== "owner") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const svc = createServiceClient();
  const { data: cfg } = svc
    ? await svc.from("service_config").select("enabled").eq("key", "anthropic_vision").maybeSingle()
    : { data: null };
  if (!cfg?.enabled) return NextResponse.json({ error: "AI is off (Services page)." }, { status: 503 });

  const body = (await request.json().catch(() => null)) as { imageBase64?: string; mediaType?: string; replacePath?: string } | null;
  if (!body?.imageBase64) return NextResponse.json({ error: "No image." }, { status: 400 });
  if (body.imageBase64.length > MAX_B64) return NextResponse.json({ error: "Image too large." }, { status: 413 });
  // Anthropic accepts image/jpeg (not image/jpg); normalize so a valid JPEG isn't rejected.
  const mt0 = body.mediaType && /^image\/(png|jpe?g|webp|gif)$/.test(body.mediaType) ? body.mediaType : "image/jpeg";
  const mediaType = mt0 === "image/jpg" ? "image/jpeg" : mt0;

  let parsed: z.infer<typeof Schema> | undefined;
  try {
    const msg = await anthropic.messages.parse({
      model: HAIKU_MODEL,
      max_tokens: 600,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType as "image/jpeg", data: body.imageBase64 } },
          { type: "text", text: "Read this purchase receipt and return the vendor, date, and grand total." },
        ],
      }],
      output_config: { format: zodOutputFormat(Schema) },
    });
    parsed = msg.parsed_output ?? undefined;
  } catch (e) {
    console.error("[receipts/scan] vision read failed:", e);
    return NextResponse.json({ error: "Couldn't read the receipt — try a clearer photo." }, { status: 502 });
  }
  if (!parsed) return NextResponse.json({ error: "Couldn't read the receipt." }, { status: 422 });

  // Re-scanning replaces a not-yet-saved image: drop the prior object so abandoned
  // scans don't accumulate (guard the path to the caller's own folder).
  if (body.replacePath && body.replacePath.startsWith(`${user.id}/`)) {
    await supabase.storage.from("receipts").remove([body.replacePath]).catch(() => {});
  }

  // Store the image (private, foldered by user id for the RLS policy). Best-effort:
  // the extracted numbers are the point, so a storage hiccup still returns a prefill —
  // but only hand back image_path when the object actually landed (no dangling ref).
  const path = `${user.id}/${randomUUID()}.${mediaType.split("/")[1]}`;
  const bytes = Buffer.from(body.imageBase64, "base64");
  const { error: upErr } = await supabase.storage.from("receipts").upload(path, bytes, { contentType: mediaType, upsert: false });

  return NextResponse.json({
    image_path: upErr ? null : path,
    amount: Math.abs(parsed.total),
    vendor: parsed.vendor || "",
    receipt_date: coerceDate(parsed.date),
  });
}
