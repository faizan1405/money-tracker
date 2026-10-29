import { createFileRoute } from "@tanstack/react-router";
import { AssistantChat } from "@/components/app/Assistant";
import { PageHeader } from "@/components/app/ui-bits";

export const Route = createFileRoute("/assistant")({
  head: () => ({
    meta: [
      { title: "Assistant — Money Hub AI" },
      { name: "description", content: "Ask questions about your spending, profit and dues." },
      { property: "og:title", content: "Assistant — Money Hub AI" },
      { property: "og:description", content: "Ask questions about your spending, profit and dues." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <>
      <PageHeader title="Ask Money Hub" />
      <div className="surface h-[calc(100dvh-15rem)] min-h-[520px] p-3 sm:p-4"><AssistantChat full /></div>
    </>
  ),
});
