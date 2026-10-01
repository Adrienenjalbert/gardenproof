import type { Metadata } from "next";
import { ToastHost } from "@/components/owner/feedback";
import { StartFlow } from "@/components/owner/onboarding/start-flow";

export const metadata: Metadata = { title: "Set up from your website" };

export default async function StartPage({ searchParams }: PageProps<"/start">) {
  const { url } = await searchParams;
  return (
    <>
      <StartFlow initialUrl={typeof url === "string" ? url : ""} />
      <ToastHost />
    </>
  );
}
