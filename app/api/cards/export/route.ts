// CSV export — same source route as MasterOps. (The pricing daemon is
// deliberately NOT mirrored: it runs only from the MasterOps cron.)
export { GET, POST } from "@/app/api/cards/export/route";
export const dynamic = "force-dynamic";
