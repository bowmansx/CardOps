// Push CardOps' ledger to a business's books — same source route as MasterOps.
export { POST } from "@/app/api/cards/connectors/push/route";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
