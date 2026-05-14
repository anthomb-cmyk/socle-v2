import { redirect } from "next/navigation";

// The dedicated /inbound-calls list is now the "Récents" tab inside
// the unified /quick-call (Téléphone) page. Bookmarks land directly
// on that tab.
export default function InboundCallsPage() {
  redirect("/quick-call?tab=recents");
}
