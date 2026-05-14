import { redirect } from "next/navigation";
import { createDemoHarness, createDraftHarness } from "@/lib/harness-create";
import { isDemoMode } from "@/lib/demo-mode";

export default async function Page() {
  const harness = isDemoMode() ? await createDemoHarness() : await createDraftHarness();
  redirect(`/harness/${harness.id}`);
}
