// Daily card-news cron — CRON_SECRET-guarded.
export { GET } from "@/app/api/cron/card-news/route";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
