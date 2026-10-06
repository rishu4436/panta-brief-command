import type { Metadata } from "next";
import { CreateMarketWorkspace } from "@/components/create/CreateMarketWorkspace";

export const metadata: Metadata = { title: "Create Market" };

export default function CreatePage() {
  return <CreateMarketWorkspace />;
}
