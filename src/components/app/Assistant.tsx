import { useRef, useState } from "react";
import { Send, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useFinance, useScoped } from "@/lib/finance/store";
import { SUGGESTED, answer, type Answer } from "@/lib/finance/assistant";
import { cn } from "@/lib/utils";
import { aiApi } from "@/lib/api/services";

type Msg = { role: "user"; text: string } | { role: "bot"; a: Answer };

export function AssistantChat({ className }: { className?: string }) {
  const { recurring, mode, workspace } = useFinance();
  const live = mode === "production";
  const [busy, setBusy] = useState(false);
  const { txns, dues } = useScoped();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState("");
  const end = useRef<HTMLDivElement>(null);

  const ask = (text: string) => {
    if (!text.trim()) return;
    setQ("");
    if (live) {
      const history = [...msgs, { role: "user" as const, text }];
      setMsgs(history);
      setBusy(true);
      aiApi
        .chat({ workspace, messages: history.map((m) => (m.role === "user" ? { role: "user" as const, content: m.text } : { role: "assistant" as const, content: m.a.text })) })
        .then((r) => setMsgs((m) => [...m, { role: "bot", a: { text: r.reply, rows: r.rows } as Answer }]))
        .catch((e: unknown) => setMsgs((m) => [...m, { role: "bot", a: { text: `The assistant is unavailable: ${e instanceof Error ? e.message : "unknown error"}` } as Answer }]))
        .finally(() => setBusy(false));
    } else {
      setMsgs((m) => [...m, { role: "user", text }, { role: "bot", a: answer(text, txns, dues, recurring) }]);
    }
    setTimeout(() => end.current?.scrollIntoView({ behavior: "smooth" }), 50);
  };

  return (
    <div className={cn("flex h-full flex-col", className)}>
      <div className="mb-3 rounded-xl bg-info-soft px-3 py-2 text-xs text-info">
        {live ? "Answers come from the AI on your Money Hub server, using your real data." : "Preview Mode: answers are calculated directly from your demo data using fixed rules. The AI assistant arrives with the backend."}
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto pr-1">
        {msgs.length === 0 && (
          <div className="py-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-medium"><Sparkles className="size-4 text-primary" />Try asking</div>
            <div className="flex flex-wrap gap-2">
              {SUGGESTED.map((s) => (
                <button key={s} onClick={() => ask(s)} className="rounded-full border bg-card px-3 py-1.5 text-left text-xs transition-colors hover:border-primary hover:text-primary">{s}</button>
              ))}
            </div>
          </div>
        )}
        {msgs.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3.5 py-2 text-sm text-primary-foreground">{m.text}</div>
          ) : (
            <div key={i} className="max-w-[92%] rounded-2xl rounded-bl-sm border bg-card p-3.5 text-sm">
              <p>{m.a.text}</p>
              {m.a.rows && m.a.rows.length > 0 && (
                <ul className="mt-3 divide-y rounded-xl bg-secondary/60 px-3">
                  {m.a.rows.map((r) => (
                    <li key={r.label} className="flex justify-between gap-3 py-2 text-xs">
                      <span className="text-muted-foreground">{r.label}</span>
                      <span className={cn("num font-semibold", r.tone === "positive" && "text-positive", r.tone === "negative" && "text-negative")}>{r.value}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ),
        )}
        {busy && <div className="text-xs text-muted-foreground">Thinking…</div>}
        <div ref={end} />
      </div>
      <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); ask(q); }}>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about your money…" aria-label="Ask a question" />
        <Button type="submit" size="icon" aria-label="Send"><Send className="size-4" /></Button>
      </form>
    </div>
  );
}
