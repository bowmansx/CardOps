// Vision scan for the intake camera — same source route as MasterOps.
// (Segment config must be declared literally, not re-exported.)
export { POST } from "@/app/api/cards/intake/scan/route";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
