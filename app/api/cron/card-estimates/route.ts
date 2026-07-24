// Daily card-estimates cron — CRON_SECRET-guarded.
export { GET } from "@/app/api/cron/card-estimates/route";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
