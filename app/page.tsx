import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// The standalone app IS the cards module — land straight on the inventory.
export default function Home() {
  redirect("/cards");
}
