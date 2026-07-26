import { z } from "zod";

// Shared shape for the AI grade estimate — the route validates output with it
// and pages safeParse stored jsonb before rendering (vision_confidence is
// client-writable jsonb; never render it unvalidated — day-review finding).
export const CompanyEst = z.object({
  low: z.number(),
  high: z.number(),
  confidence: z.number(),
  rationale: z.string(),
});

export const EstimateSchema = z.object({
  image_quality: z.string(),
  key_observations: z.string(),
  psa: CompanyEst,
  bgs: CompanyEst,
  sgc: CompanyEst,
  cgc: CompanyEst,
  caveats: z.string(),
  at: z.string().optional(),
  // Which views the model actually saw. An estimate from a front photo and one
  // from a full twelve-shot template are different claims; storing the basis
  // is what lets a screen say which it is showing (optional so estimates made
  // before templates still parse).
  views: z.array(z.string()).optional(),
  missing_views: z.array(z.string()).optional(),
});

export type Estimate = z.infer<typeof EstimateSchema>;

export function parseStoredEstimate(v: unknown): Estimate | null {
  const r = EstimateSchema.safeParse(v);
  return r.success ? r.data : null;
}
