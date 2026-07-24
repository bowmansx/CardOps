// Daily card-alerts cron — CRON_SECRET-guarded.
export { GET } from "@/app/api/cron/card-alerts/route";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
