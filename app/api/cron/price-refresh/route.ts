// Daily price-refresh cron — CRON_SECRET-guarded.
export { GET } from "@/app/api/cron/price-refresh/route";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
