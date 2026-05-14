import { notFound } from "next/navigation";
import HarnessRunPage from "@/components/HarnessRunPage";
import { getHarness } from "@/lib/harness-store";

interface HarnessRunPageProps {
  params: Promise<{
    id: string;
  }>;
}

export default async function RunDetailPage({ params }: HarnessRunPageProps) {
  const { id } = await params;
  const harness = getHarness(id);

  if (!harness) {
    notFound();
  }

  return <HarnessRunPage harnessId={id} initialHarness={harness} />;
}
