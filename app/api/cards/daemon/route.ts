// Daily card daemon — the cron workhorse (estimates, refreshes).
export { GET } from "@/app/api/cards/daemon/route";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
