// eBay order sync — POST from the hub button, GET from the daily cron.
export { GET, POST } from "@/app/api/ebay/sync/route";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
