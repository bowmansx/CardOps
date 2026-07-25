// Cost-basis line items. Shell over the src/ implementation; the segment
// config below must stay identical to it (config does not inherit).
export { GET, POST, PATCH, DELETE } from "@/app/api/cards/basis-items/route";
export const dynamic = "force-dynamic";
