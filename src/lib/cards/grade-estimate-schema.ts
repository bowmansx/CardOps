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
});

export type Estimate = z.infer<typeof EstimateSchema>;

export function parseStoredEstimate(v: unknown): Estimate | null {
  const r = EstimateSchema.safeParse(v);
  return r.success ? r.data : null;
}
