import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { HandCoins, Landmark, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useFinance, useScoped } from "@/lib/finance/store";
import { formatDate, formatINR } from "@/lib/finance/format";
import type { Due } from "@/lib/finance/types";
import { EmptyState, PageHeader, Pill, Progress } from "@/components/app/ui-bits";

export const Route = createFileRoute("/loans")({
  head: () => ({
    meta: [
      { title: "Loans & Dues — Money Hub AI" },
      { name: "description", content: "Loans, EMIs, money you owe and money owed to you." },
      { property: "og:title", content: "Loans & Dues — Money Hub AI" },
      { property: "og:description", content: "Loans, EMIs, money you owe and money owed to you." },
    ],
  }),
  component: Loans,
});

function status(d: Due) {
  if (d.outstanding <= 0) return { label: "Settled", tone: "positive" as const };
  const days = (new Date(d.dueDate).getTime() - Date.now()) / 864e5;
  if (days < 0) return { label: `Overdue ${Math.ceil(-days)}d`, tone: "negative" as const };
  if (days <= 7) return { label: `Due in ${Math.ceil(days)}d`, tone: "warning" as const };
  return { label: "Upcoming", tone: "neutral" as const };
}

function Loans() {
  const f = useFinance();
  const { dues } = useScoped();
  const [pay, setPay] = useState<Due | null>(null);
  const [add, setAdd] = useState(false);
  const owe = dues.filter((d) => d.direction === "i_owe");
  const owed = dues.filter((d) => d.direction === "owed_to_me");

  const groups = {
    owe, owed,
    clients: owed.filter((d) => d.kind === "client"),
    loans: owe.filter((d) => d.kind === "loan" || d.kind === "personal"),
    emis: owe.filter((d) => d.emi).sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
  };

  return (
    <>
      <PageHeader title="Loans, EMIs & dues" subtitle="Principal repayments reduce what you owe. Only interest counts as an expense." actions={<Button onClick={() => setAdd(true)}><Plus className="size-4" />New record</Button>} />
      <div className="mb-4 grid grid-cols-2 gap-3">
        <div className="surface p-4"><div className="flex items-center gap-2 text-xs text-muted-foreground"><Landmark className="size-4" />Money I owe</div><div className="num mt-2 text-2xl font-semibold text-negative">{formatINR(owe.reduce((s, d) => s + d.outstanding, 0))}</div></div>
        <div className="surface p-4"><div className="flex items-center gap-2 text-xs text-muted-foreground"><HandCoins className="size-4" />Others owe me</div><div className="num mt-2 text-2xl font-semibold text-positive">{formatINR(owed.reduce((s, d) => s + d.outstanding, 0))}</div></div>
      </div>
      <Tabs defaultValue="owe">
        <TabsList className="h-auto flex-wrap justify-start">
          <TabsTrigger value="owe">Money I Owe</TabsTrigger>
          <TabsTrigger value="owed">Others Owe Me</TabsTrigger>
          <TabsTrigger value="clients">Client Payments</TabsTrigger>
          <TabsTrigger value="loans">Active Loans</TabsTrigger>
          <TabsTrigger value="emis">Upcoming EMIs</TabsTrigger>
        </TabsList>
        {(Object.keys(groups) as (keyof typeof groups)[]).map((k) => (
          <TabsContent key={k} value={k} className="mt-4">
            {groups[k].length ? (
              <div className="grid gap-3 md:grid-cols-2">
                {groups[k].map((d) => {
                  const st = status(d);
                  const paid = d.principal - d.outstanding;
                  const interest = d.payments.reduce((s, p) => s + (p.interest ?? 0), 0);
                  return (
                    <article key={d.id} className="surface p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div><div className="font-semibold">{d.party}</div><div className="text-xs capitalize text-muted-foreground">{d.kind}{d.interestRate && ` · ${d.interestRate}% p.a.`} · due {formatDate(d.dueDate)}</div></div>
                        <Pill tone={st.tone}>{st.label}</Pill>
                      </div>
                      <div className="mt-4 flex items-end justify-between">
                        <div><div className="text-xs text-muted-foreground">Outstanding</div><div className="num text-xl font-semibold">{formatINR(d.outstanding)}</div></div>
                        <div className="text-right text-xs text-muted-foreground">of {formatINR(d.principal)}{d.emi && <div>EMI {formatINR(d.emi)}</div>}</div>
                      </div>
                      <div className="mt-2"><Progress value={(paid / d.principal) * 100} tone="positive" /></div>
                      {d.payments.length > 0 && (
                        <ul className="mt-3 space-y-1 border-t pt-3 text-xs">
                          {d.payments.map((p, i) => <li key={i} className="flex justify-between"><span className="text-muted-foreground">{formatDate(p.date)}</span><span className="num">{formatINR(p.amount)}{p.interest ? ` (interest ${formatINR(p.interest)})` : ""}</span></li>)}
                          {interest > 0 && <li className="pt-1 text-muted-foreground">Total interest paid: {formatINR(interest)}</li>}
                        </ul>
                      )}
                      {d.notes && <p className="mt-2 text-xs text-muted-foreground">{d.notes}</p>}
                      {d.outstanding > 0 && <Button size="sm" variant="outline" className="mt-3 w-full" onClick={() => setPay(d)}>{d.direction === "i_owe" ? "Record repayment" : "Record payment received"}</Button>}
                    </article>
                  );
                })}
              </div>
            ) : <EmptyState title="Nothing here" text="No records in this section for the selected workspace." />}
          </TabsContent>
        ))}
      </Tabs>
      <PayDialog due={pay} onClose={() => setPay(null)} onSave={async (amt, interest) => {
        if (!pay) return;
        // Use a real account from the same workspace (bank first) — never a hard-coded demo id.
        const pool = f.accounts.filter((a) => a.workspace === pay.workspace && a.kind !== "credit_card");
        const acc = pool.find((a) => a.kind === "bank") ?? pool[0];
        if (!acc) { toast.error("Add a bank or cash account in this workspace first"); return; }
        const date = new Date().toISOString().slice(0, 10);
        const txn: Omit<Transaction, "id"> = pay.direction === "i_owe"
          ? { type: "loan_repayment", amount: amt, interest, merchant: pay.party, description: `Repayment — ${pay.party}`, category: "Loan", workspace: pay.workspace, accountId: acc.id, date, status: "cleared", source: "manual" }
          : pay.kind === "client"
            ? { type: "income", amount: amt, merchant: pay.party, client: pay.party, description: `Payment received — ${pay.party}`, category: "Client Payment", workspace: pay.workspace, accountId: acc.id, date, status: "cleared", source: "manual" }
            : { type: "adjustment", adjustmentSign: 1, amount: amt, merchant: pay.party, description: `Money returned — ${pay.party}`, category: "Loan", workspace: pay.workspace, accountId: acc.id, date, status: "cleared", source: "manual" };
        if (!(await f.addTxn(txn))) return; // nothing changed if the transaction failed
        const principalPart = Math.min(pay.outstanding, amt - interest);
        const ok = await f.update("dues", f.dues.map((d) => d.id === pay.id ? { ...d, outstanding: d.outstanding - principalPart, payments: [{ date, amount: amt, ...(interest ? { interest } : {}) }, ...d.payments] } : d));
        if (ok) toast.success("Payment recorded and added to transactions");
        else toast.error("The transaction was saved, but the loan balance didn't update. Please try again.");
        setPay(null);
      }} />
      <NewDueDialog open={add} onClose={() => setAdd(false)} onSave={async (d) => { if (await f.update("dues", [d, ...f.dues])) { toast.success("Record added"); setAdd(false); } }} />
    </>
  );
}

function PayDialog({ due, onClose, onSave }: { due: Due | null; onClose: () => void; onSave: (amount: number, interest: number) => void }) {
  const [amt, setAmt] = useState("");
  const [interest, setInterest] = useState("");
  return (
    <Dialog open={!!due} onOpenChange={(o) => { if (!o) { onClose(); setAmt(""); setInterest(""); } }}>
      <DialogContent>
        <DialogHeader><DialogTitle>{due?.party}</DialogTitle><DialogDescription>Outstanding {formatINR(due?.outstanding ?? 0)}</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <div><Label>Amount (₹)</Label><Input className="mt-1.5" inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value)} /></div>
          {due?.direction === "i_owe" && <div><Label>Interest portion (₹)</Label><Input className="mt-1.5" inputMode="decimal" value={interest} onChange={(e) => setInterest(e.target.value)} /><p className="mt-1 text-xs text-muted-foreground">Only this part is counted as an expense.</p></div>}
          <Button className="w-full" onClick={() => { const a = Number(amt); if (!a) { toast.error("Enter an amount"); return; } onSave(a, Number(interest) || 0); setAmt(""); setInterest(""); }}>Save payment</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function NewDueDialog({ open, onClose, onSave }: { open: boolean; onClose: () => void; onSave: (d: Due) => void }) {
  const [d, setD] = useState<Partial<Due>>({ direction: "i_owe", kind: "personal", workspace: "personal" });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>New loan or due</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2"><Label>Person, company or lender</Label><Input className="mt-1.5" value={d.party ?? ""} onChange={(e) => setD({ ...d, party: e.target.value })} /></div>
          <div><Label>Direction</Label><Select value={d.direction ?? ""} onValueChange={(v) => setD({ ...d, direction: v as Due["direction"] })}><SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="i_owe">I owe</SelectItem><SelectItem value="owed_to_me">Owed to me</SelectItem></SelectContent></Select></div>
          <div><Label>Kind</Label><Select value={d.kind ?? ""} onValueChange={(v) => setD({ ...d, kind: v as Due["kind"] })}><SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="personal">Personal</SelectItem><SelectItem value="loan">Bank loan</SelectItem><SelectItem value="emi">EMI</SelectItem><SelectItem value="client">Client</SelectItem></SelectContent></Select></div>
          <div><Label>Amount (₹)</Label><Input className="mt-1.5" inputMode="decimal" onChange={(e) => setD({ ...d, principal: Number(e.target.value), outstanding: Number(e.target.value) })} /></div>
          <div><Label>Due date</Label><Input className="mt-1.5" type="date" onChange={(e) => setD({ ...d, dueDate: new Date(e.target.value).toISOString() })} /></div>
          <div><Label>Interest % (optional)</Label><Input className="mt-1.5" inputMode="decimal" onChange={(e) => setD({ ...d, interestRate: Number(e.target.value) || undefined })} /></div>
          <div><Label>Workspace</Label><Select value={d.workspace ?? ""} onValueChange={(v) => setD({ ...d, workspace: v as Due["workspace"] })}><SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="personal">Personal</SelectItem><SelectItem value="scaleflow">Scale Flow</SelectItem></SelectContent></Select></div>
        </div>
        <Button onClick={() => {
          if (!d.party || !d.principal || !d.dueDate) { toast.error("Fill in name, amount and due date"); return; }
          onSave({ ...(d as Due), id: `d${Date.now()}`, payments: [] });
          setD({ direction: "i_owe", kind: "personal", workspace: "personal" });
        }}>Save</Button>
      </DialogContent>
    </Dialog>
  );
}
