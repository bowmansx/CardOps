// Scan a cost receipt (Vision prefill) — same source route as MasterOps.
export { POST } from "@/app/api/cards/receipts/scan/route";
export const dynamic = "force-dynamic";
export const maxDuration = 45;
