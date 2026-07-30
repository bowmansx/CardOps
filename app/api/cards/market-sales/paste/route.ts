// Import pasted sold comps into the shared identity's history.
// Segment config is re-declared literally — it does NOT inherit through a
// re-export, and a shell that omits maxDuration silently runs on the default.
export { POST } from "@/app/api/cards/market-sales/paste/route";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
