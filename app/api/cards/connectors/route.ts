// CardOps connector setup — same source route as MasterOps.
export { GET, PUT } from "@/app/api/cards/connectors/route";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
