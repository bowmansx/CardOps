// Named photo-capture presets. Shell over the src/ implementation; the segment
// config below must stay identical to it (config does not inherit).
export { GET, POST, DELETE } from "@/app/api/cards/photo-presets/route";
export const dynamic = "force-dynamic";
