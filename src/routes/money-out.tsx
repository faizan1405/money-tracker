import { createFileRoute } from "@tanstack/react-router";
import { FlowPage } from "@/components/app/FlowPage";

export const Route = createFileRoute("/money-out")({
  head: () => ({
    meta: [
      { title: "Money Out — Money Hub AI" },
      { name: "description", content: "See every personal and business expense by category." },
      { property: "og:title", content: "Money Out — Money Hub AI" },
      { property: "og:description", content: "See every personal and business expense by category." },
    ],
  }),
  component: () => <FlowPage mode="out" />,
});
