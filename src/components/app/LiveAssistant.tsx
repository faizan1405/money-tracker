import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { AlertTriangle, BadgeCheck, History, Lightbulb, Loader2, MessageSquarePlus, RefreshCw, Send, ShieldCheck, Trash2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useFinance } from "@/lib/finance/store";
import { formatCompact, formatDate, formatINR, formatINRExact } from "@/lib/finance/format";
import { aiApi } from "@/lib/api/services";
import { ApiError } from "@/lib/api/client";
import type { AiUsageResponse, AssistantFacts, AssistantMessage, ConversationSummary, Insight, InsightSuggestions } from "@/lib/api/contracts";
import { CHART_COLORS, Pill, tooltipStyle } from "@/components/app/ui-bits";
import { cn } from "@/lib/utils";

const MAX = 500;
export const LIVE_SUGGESTED = [
  "How much did I spend this month?",
  "What was my Scale Flow profit?",
  "Where is most of my money going?",
  "Compare this month with last month.",
  "How much money do I have across my accounts?",
  "Who owes me money?",
  "What are my upcoming payments?",
  "Which expenses are increasing?",
  "is mahine kitna kharcha hua?",
];

const rupees = (paise: number) => (paise % 100 === 0 ? formatINR(paise / 100) : formatINRExact(paise / 100));
const WS_LABEL: Record<string, string> = { all: "All workspaces", personal: "Personal", scaleflow: "Scale Flow" };

type Pending = { role: "user"; content: string; id: string } | { role: "error"; content: string; id: string; retry: string };
type Item = AssistantMessage | Pending;

function errorText(e: unknown) {
  if (e instanceof ApiError) return e.message;
  return "Something went wrong. Please try again.";
}

/** Production assistant: answers come from the server's verified calculations; the AI only explains them. */
export function LiveAssistant({ compact = false }: { compact?: boolean }) {
  const { workspace } = useFinance();
  const [convs, setConvs] = useState<ConversationSummary[]>([]);
  const [retention, setRetention] = useState<number | null>(null);
  const [active, setActive] = useState<string | undefined>();
  const [items, setItems] = useState<Item[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadingConv, setLoadingConv] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const scroll = () => setTimeout(() => end.current?.scrollIntoView({ behavior: "smooth", block: "end" }), 30);

  const refreshList = useCallback(() => {
    aiApi.conversations().then((r) => { setConvs(r.items); setRetention(r.retentionDays); }).catch(() => {});
  }, []);
  useEffect(() => { if (!compact) refreshList(); }, [compact, refreshList]);

  const open = async (id: string) => {
    setLoadingConv(true);
    try {
      const c = await aiApi.conversation(id);
      setActive(c.id);
      setItems(c.messages);
      scroll();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setLoadingConv(false);
    }
  };
  const newChat = () => { setActive(undefined); setItems([]); setQ(""); };
  const remove = async (id: string) => {
    if (!window.confirm("Delete this conversation? This can't be undone.")) return;
    try {
      await aiApi.deleteConversation(id);
      setConvs((l) => l.filter((c) => c.id !== id));
      if (active === id) newChat();
      toast.success("Conversation deleted");
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  const ask = async (text: string) => {
    const message = text.trim();
    if (!message || busy) return;
    if (message.length > MAX) return void toast.error(`Keep questions under ${MAX} characters.`);
    setQ("");
    const pendingId = `u-${Date.now()}`;
    setItems((l) => [...l.filter((x) => x.role !== "error"), { role: "user", content: message, id: pendingId }]);
    setBusy(true);
    scroll();
    try {
      const r = await aiApi.chat({ message, workspace, ...(active ? { conversationId: active } : {}) });
      setActive(r.conversationId);
      setItems((l) => [...l, r.message]);
      if (!compact) refreshList();
    } catch (e) {
      setItems((l) => [...l, { role: "error", id: `e-${Date.now()}`, content: errorText(e), retry: message }]);
    } finally {
      setBusy(false);
      scroll();
    }
  };

  const chat = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
        <Pill tone="primary"><ShieldCheck className="size-3" />Numbers are calculated from your records</Pill>
        <Pill>Asking about: {WS_LABEL[workspace] ?? workspace}</Pill>
        {compact && <Link to="/assistant" className="ml-auto inline-flex items-center gap-1 text-muted-foreground hover:text-primary"><History className="size-3.5" />History</Link>}
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1" aria-live="polite">
        {loadingConv && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Loading conversation…</div>}
        {!loadingConv && items.length === 0 && (
          <div className="py-2">
            <p className="mb-1 font-display text-lg">Ask about your money</p>
            <p className="mb-3 text-sm text-muted-foreground">English, Hindi or Hinglish. Ask follow-ups like “what about last month?” or “only for Scale Flow”.</p>
            <div className="flex flex-wrap gap-2">
              {LIVE_SUGGESTED.slice(0, compact ? 5 : 9).map((s) => (
                <button key={s} onClick={() => void ask(s)} className="rounded-full border bg-card px-3 py-1.5 text-left text-xs transition-colors hover:border-primary hover:text-primary">{s}</button>
              ))}
            </div>
          </div>
        )}
        {items.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className="ml-auto max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-sm bg-primary px-3.5 py-2 text-sm text-primary-foreground">{m.content}</div>
          ) : m.role === "error" ? (
            <div key={m.id} role="alert" className="max-w-[92%] rounded-2xl rounded-bl-sm border border-negative/30 bg-negative-soft p-3.5 text-sm text-negative">
              <div className="flex items-start gap-2"><AlertTriangle className="mt-0.5 size-4 shrink-0" /><span>{m.content}</span></div>
              <Button size="sm" variant="outline" className="mt-2" onClick={() => void ask(m.retry)}><RefreshCw className="size-3.5" />Try again</Button>
            </div>
          ) : (
            <AnswerCard key={m.id} m={m} compact={compact} />
          ),
        )}
        {busy && (
          <div className="flex max-w-[92%] items-center gap-2 rounded-2xl rounded-bl-sm border bg-card p-3.5 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin text-primary" />Checking your records…
          </div>
        )}
        <div ref={end} />
      </div>
      <form className={cn("mt-3 flex items-end gap-2", !compact && "max-md:pr-16")} onSubmit={(e) => { e.preventDefault(); void ask(q); }}>
        <div className="relative flex-1">
          <Textarea
            value={q} maxLength={MAX} rows={1} disabled={busy}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void ask(q); } }}
            placeholder="Ask about your money…" aria-label="Ask a question"
            className="max-h-32 min-h-10 resize-none pr-14"
          />
          {q.length > MAX - 100 && <span className="pointer-events-none absolute bottom-2 right-3 text-[10px] text-muted-foreground">{q.length}/{MAX}</span>}
        </div>
        <Button type="submit" size="icon" aria-label="Send" disabled={busy || !q.trim()} className="size-10 shrink-0"><Send className="size-4" /></Button>
      </form>
    </div>
  );

  if (compact) return chat;

  return (
    <Tabs defaultValue="chat" className="flex h-full min-h-0 min-w-0 flex-col">
      <TabsList className="mb-3 self-start">
        <TabsTrigger value="chat">Chat</TabsTrigger>
        <TabsTrigger value="insights">Insights</TabsTrigger>
        <TabsTrigger value="usage">AI usage</TabsTrigger>
      </TabsList>
      <TabsContent value="chat" className="mt-0 min-h-0 flex-1">
        <div className="flex h-full min-h-0 flex-col gap-3 md:grid md:grid-cols-[220px_minmax(0,1fr)] md:gap-4">
          <aside className="flex min-w-0 shrink-0 flex-col gap-2 md:min-h-0 md:border-r md:pr-4">
            <Button variant="outline" size="sm" onClick={newChat} className="justify-start"><MessageSquarePlus className="size-4" />New conversation</Button>
            <div className="flex gap-2 overflow-x-auto md:min-h-0 md:flex-1 md:flex-col md:overflow-y-auto">
              {convs.length === 0 && <p className="hidden px-1 text-xs text-muted-foreground md:block">No saved conversations yet.</p>}
              {convs.map((c) => (
                <div key={c.id} className={cn("group flex shrink-0 items-center gap-1 rounded-lg border px-2 py-1.5 text-xs md:border-transparent", active === c.id ? "bg-primary-soft text-primary md:border-primary/20" : "hover:bg-secondary")}>
                  <button onClick={() => void open(c.id)} className="min-w-0 max-w-[180px] flex-1 text-left">
                    <span className="block truncate font-medium">{c.title}</span>
                    <span className="block text-[10px] text-muted-foreground">{formatDate(c.updatedAt, { day: "2-digit", month: "short" })}</span>
                  </button>
                  <button onClick={() => void remove(c.id)} aria-label={`Delete conversation ${c.title}`} className="rounded p-1 text-muted-foreground hover:bg-negative-soft hover:text-negative"><Trash2 className="size-3.5" /></button>
                </div>
              ))}
            </div>
            {retention && <p className="hidden text-[10px] leading-snug text-muted-foreground md:block">Conversations are kept for {retention} days on your server, then deleted.</p>}
          </aside>
          <div className="min-h-0 min-w-0 flex-1">{chat}</div>
        </div>
      </TabsContent>
      <TabsContent value="insights" className="mt-0 min-h-0 flex-1 overflow-y-auto"><InsightsPanel /></TabsContent>
      <TabsContent value="usage" className="mt-0 min-h-0 flex-1 overflow-y-auto"><UsagePanel /></TabsContent>
    </Tabs>
  );
}

function AnswerCard({ m, compact }: { m: AssistantMessage; compact: boolean }) {
  const f = m.facts;
  return (
    <div className="max-w-[96%] space-y-3 rounded-2xl rounded-bl-sm border bg-card p-3.5 text-sm">
      <p className="whitespace-pre-wrap leading-relaxed">{m.content}</p>
      {f && f.metric !== "unsupported" && (
        <>
          <div className="flex flex-wrap gap-1.5">
            <Pill tone="positive"><BadgeCheck className="size-3" />Verified from your records</Pill>
            <Pill>{f.workspaceLabel}</Pill>
            <Pill>{f.period.label}{f.comparePeriod ? ` vs ${f.comparePeriod.label}` : ""}</Pill>
          </div>
          {f.figures.length > 0 && <Figures f={f} />}
          {!compact && f.chart && f.chart.points.some((p) => p.a || p.b) && <MiniChart f={f} />}
          {f.rows && f.rows.length > 0 && (
            <div>
              {f.rowsTitle && <div className="mb-1 text-xs font-medium text-muted-foreground">{f.rowsTitle}</div>}
              <ul className="divide-y rounded-xl bg-secondary/60 px-3">
                {f.rows.map((r, i) => (
                  <li key={`${r.label}-${i}`} className="flex items-center justify-between gap-3 py-2 text-xs">
                    <span className="min-w-0"><span className="block truncate">{r.label}</span>{r.sub && <span className="text-[11px] text-muted-foreground">{r.sub}</span>}</span>
                    <span className={cn("num shrink-0 font-semibold", r.paise < 0 && "text-negative")}>{rupees(r.paise)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {f.transactions && f.transactions.length > 0 && (
            <div>
              <div className="mb-1 text-xs font-medium text-muted-foreground">Transactions</div>
              <ul className="space-y-1">
                {f.transactions.map((t) => (
                  <li key={t.id}>
                    <Link to="/transactions" search={{ q: t.merchant }} className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-xs hover:bg-secondary">
                      <span className="min-w-0 truncate"><span className="text-muted-foreground">{formatDate(t.date, { day: "2-digit", month: "short" })}</span> · {t.merchant || t.category}</span>
                      <span className="num shrink-0 font-medium">{rupees(t.paise)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {f.notes.length > 0 && <ul className="space-y-0.5 text-[11px] text-muted-foreground">{f.notes.map((n) => <li key={n}>• {n}</li>)}</ul>}
        </>
      )}
      {m.suggestions && m.suggestions.length > 0 && (
        <div className="rounded-xl border border-dashed bg-warning-soft/40 p-3">
          <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-warning"><Lightbulb className="size-3.5" />AI suggestions — ideas, not verified facts</div>
          <ul className="list-disc space-y-0.5 pl-4 text-xs">{m.suggestions.map((s) => <li key={s}>{s}</li>)}</ul>
        </div>
      )}
      {m.aiExplained === false && f?.metric !== "unsupported" && <p className="text-[11px] text-muted-foreground">The AI explanation wasn't available, so this is the plain calculated summary.</p>}
    </div>
  );
}

function Figures({ f }: { f: AssistantFacts }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {f.figures.map((x) => (
        <div key={x.key} className="rounded-xl bg-secondary/60 p-2.5">
          <div className="line-clamp-2 text-[11px] text-muted-foreground">{x.label}</div>
          <div className={cn("num mt-0.5 font-display text-base font-semibold", x.tone === "positive" && "text-positive", x.tone === "negative" && "text-negative")}>
            {x.text ?? (x.paise === undefined ? "—" : rupees(x.paise))}
          </div>
        </div>
      ))}
    </div>
  );
}

function MiniChart({ f }: { f: AssistantFacts }) {
  const c = f.chart!;
  const data = c.points.map((p) => ({ label: p.label, a: p.a / 100, b: p.b === undefined ? undefined : p.b / 100 }));
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-muted-foreground">{c.title} (last 6 months)</div>
      <div className="h-36">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ left: -12, right: 4, top: 4, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} stroke="var(--muted-foreground)" />
            <YAxis tickLine={false} axisLine={false} fontSize={10} width={52} tickFormatter={(v: number) => formatCompact(v)} stroke="var(--muted-foreground)" />
            <Tooltip {...tooltipStyle} formatter={(v: number, n: string) => [formatINR(v), n === "a" ? c.series[0] : c.series[1]]} />
            <Bar dataKey="a" fill={CHART_COLORS[0]} radius={[4, 4, 0, 0]} />
            {c.series.length > 1 && <Bar dataKey="b" fill={CHART_COLORS[1]} radius={[4, 4, 0, 0]} />}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function InsightsPanel() {
  const { workspace } = useFinance();
  const [items, setItems] = useState<Insight[] | null>(null);
  const [asOf, setAsOf] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [sugg, setSugg] = useState<InsightSuggestions | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    setItems(null); setErr(null); setSugg(null);
    aiApi.insights(workspace).then((r) => { setItems(r.items); setAsOf(r.asOf); }).catch((e: unknown) => setErr(errorText(e)));
  }, [workspace]);
  useEffect(load, [load]);
  const suggest = async () => {
    setBusy(true);
    try { setSugg(await aiApi.suggest(workspace)); } catch (e) { toast.error(errorText(e)); } finally { setBusy(false); }
  };
  if (err) return <div role="alert" className="rounded-xl bg-negative-soft p-4 text-sm text-negative">{err} <Button size="sm" variant="outline" className="ml-2" onClick={load}>Retry</Button></div>;
  if (!items) return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Calculating insights…</div>;
  const byId = new Map(items.map((i) => [i.id, i.title]));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground"><BadgeCheck className="mr-1 inline size-3.5 text-positive" />Verified from your records · {WS_LABEL[workspace] ?? workspace}{asOf ? ` · as of ${formatDate(asOf)}` : ""}</p>
        <Button size="sm" variant="outline" onClick={() => void suggest()} disabled={busy || items.length === 0}>{busy ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />}Get AI suggestions</Button>
      </div>
      {items.length === 0 && <p className="rounded-xl bg-secondary/60 p-4 text-sm text-muted-foreground">Not enough recorded transactions for insights yet.</p>}
      <div className="grid gap-3 md:grid-cols-2">
        {items.map((i) => (
          <article key={i.id} className={cn("rounded-2xl border bg-card p-4", i.severity === "alert" && "border-negative/40", i.severity === "warning" && "border-warning/40")}>
            <div className="mb-1 flex items-start justify-between gap-2">
              <h3 className="text-sm font-semibold">{i.title}</h3>
              {i.severity !== "info" && <Pill tone={i.severity === "alert" ? "negative" : "warning"}>{i.severity === "alert" ? "Action needed" : "Check"}</Pill>}
            </div>
            <p className="text-xs text-muted-foreground">{i.detail}</p>
            {i.figures.length > 0 && (
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                {i.figures.map((x) => <div key={x.label} className="flex justify-between gap-2"><dt className="truncate text-muted-foreground">{x.label}</dt><dd className="num font-medium">{x.value}</dd></div>)}
              </dl>
            )}
            <p className="mt-2 text-[10px] text-muted-foreground">{i.period}</p>
          </article>
        ))}
      </div>
      {sugg && (
        <div className="rounded-2xl border border-dashed bg-warning-soft/40 p-4">
          <div className="mb-2 flex items-center gap-1.5 text-sm font-medium text-warning"><Lightbulb className="size-4" />AI suggestions — ideas, not verified facts</div>
          {sugg.suggestions.length === 0 ? <p className="text-xs text-muted-foreground">No specific suggestions for these insights.</p> : (
            <ul className="space-y-2 text-sm">{sugg.suggestions.map((s) => <li key={s.text}>{s.text}<span className="block text-[11px] text-muted-foreground">Based on: {byId.get(s.basedOn) ?? s.basedOn}</span></li>)}</ul>
          )}
        </div>
      )}
    </div>
  );
}

function UsagePanel() {
  const [u, setU] = useState<AiUsageResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { aiApi.usage().then(setU).catch((e: unknown) => setErr(errorText(e))); }, []);
  if (err) return <div role="alert" className="rounded-xl bg-negative-soft p-4 text-sm text-negative">{err}</div>;
  if (!u) return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Loading…</div>;
  const usd = (n: number) => `$${n.toFixed(n < 1 ? 4 : 2)}`;
  return (
    <div className="max-w-xl space-y-3 text-sm">
      {!u.configured && <p className="rounded-xl bg-warning-soft p-3 text-warning">AI isn't set up on your server yet.</p>}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl bg-secondary/60 p-3"><div className="text-xs text-muted-foreground">Today</div><div className="num font-display text-lg">{usd(u.spentTodayUsd)}{u.limits && <span className="text-xs text-muted-foreground"> / {usd(u.limits.dailyUsd)}</span>}</div><div className="text-[11px] text-muted-foreground">{u.requestsToday} AI requests</div></div>
        <div className="rounded-xl bg-secondary/60 p-3"><div className="text-xs text-muted-foreground">This month</div><div className="num font-display text-lg">{usd(u.spentMonthUsd)}{u.limits && <span className="text-xs text-muted-foreground"> / {usd(u.limits.monthlyUsd)}</span>}</div><div className="text-[11px] text-muted-foreground">{u.requestsMonth} requests · {u.promptTokensMonth.toLocaleString("en-IN")} in / {u.completionTokensMonth.toLocaleString("en-IN")} out tokens</div></div>
      </div>
      {u.models && <p className="text-xs text-muted-foreground">Models: {u.models.fast} (main), {u.models.strong} (backup for unsure statement rows). Every request requires zero data retention.</p>}
      {u.limits && <p className="text-xs text-muted-foreground">Each AI request reserves up to {usd(u.limits.perRequestUsd)} until its real cost is known. Limits are stored on your server and don't reset on restart.</p>}
    </div>
  );
}
