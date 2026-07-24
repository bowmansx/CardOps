import { redirect } from "next/navigation";
import { currentRole, hasCardAccess } from "@/lib/cards/roles";

// Gate the whole /cards group to owner or card_ops. RLS is the real boundary;
// this keeps anyone else out of the UI entirely.
export default async function CardsLayout({ children }: { children: React.ReactNode }) {
  const role = await currentRole();
  if (!hasCardAccess(role)) redirect("/login");
  return <>{children}</>;
}
