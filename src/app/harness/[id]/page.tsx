import { notFound } from "next/navigation";
import HarnessWorkspace from "@/components/HarnessWorkspace";
import { getHarness } from "@/lib/harness-store";

export const metadata = {
  title: "Workspace",
};

interface HarnessPageProps {
  params: Promise<{
    id: string;
  }>;
}

export default async function HarnessDetailPage({ params }: HarnessPageProps) {
  const { id } = await params;
  const harness = getHarness(id);

  if (!harness) {
    notFound();
  }

  return <HarnessWorkspace harnessId={id} initialHarness={harness} />;
}
