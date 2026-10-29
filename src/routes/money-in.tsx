import { createFileRoute } from "@tanstack/react-router";
import { FlowPage } from "@/components/app/FlowPage";

export const Route = createFileRoute("/money-in")({
  head: () => ({
    meta: [
      { title: "Money In — Money Hub AI" },
      { name: "description", content: "Track salary, client payments and every source of income." },
      { property: "og:title", content: "Money In — Money Hub AI" },
      { property: "og:description", content: "Track salary, client payments and every source of income." },
    ],
  }),
  component: () => <FlowPage mode="in" />,
});
