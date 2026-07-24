import Anthropic from "@anthropic-ai/sdk";

/**
 * Server-only Anthropic client. Reads ANTHROPIC_API_KEY from the environment.
 * Never import this into a Client Component — it would leak the key.
 */
export const anthropic = new Anthropic();

// Latest, most capable model (best vision). Swap to "claude-sonnet-4-6" or
// "claude-haiku-4-5" here if you want to trade accuracy for lower cost/latency.
export const MODEL = "claude-opus-4-8";

// Cheap, fast model for high-volume/low-difficulty jobs — receipt OCR and
// merchant-name categorization. Same Anthropic API key you already use (no new
// vendor); ~$0.005 per receipt vs Opus. Escalate to MODEL only when accuracy
// matters (e.g. card grading stays on VISION_MODEL).
export const HAIKU_MODEL = "claude-haiku-4-5-20251001";

// CardOps intake model — override with VISION_MODEL env to trade accuracy for
// cost once the extraction prompt is calibrated (contract §4). Defaults to the
// known-good model above.
export const VISION_MODEL = process.env.VISION_MODEL ?? MODEL;


type ImageBlock = {
  type: "image";
  source:
    | { type: "base64"; media_type: "image/jpeg" | "image/png" | "image/webp" | "image/gif"; data: string }
    | { type: "url"; url: string };
};

const ALLOWED_MEDIA = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
] as const;

/**
 * Turn a data URL ("data:image/jpeg;base64,...") into an Anthropic image block.
 * Throws if the string isn't a supported image data URL.
 */
export function dataUrlToImageBlock(dataUrl: string): ImageBlock {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUrl ?? "");
  if (!match) {
    throw new Error("Expected a base64 image data URL.");
  }
  const media = match[1] as (typeof ALLOWED_MEDIA)[number];
  if (!ALLOWED_MEDIA.includes(media)) {
    throw new Error(`Unsupported image type: ${media}`);
  }
  return { type: "image", source: { type: "base64", media_type: media, data: match[2] } };
}
