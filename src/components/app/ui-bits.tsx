import type { ReactNode } from "react";
import {
  ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Banknote, BookOpen, Briefcase, Bus, CreditCard, Dumbbell, Film, Gift, Globe,
  HeartPulse, Home, Landmark, Megaphone, Package, Percent, Plug, Receipt, RotateCcw, ShoppingBag, ShoppingCart, Sparkles,
  Undo2, Users, UtensilsCrossed, Wallet, Wrench, Zap, type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatINR, pctChange } from "@/lib/finance/format";
import type { Transaction } from "@/lib/finance/types";

const CAT_ICONS: Record<string, LucideIcon> = {
  "Food & Dining": UtensilsCrossed, Groceries: ShoppingCart, Shopping: ShoppingBag, Transport: Bus, "Bills & Utilities": Zap,
  Rent: Home, Health: HeartPulse, Education: BookOpen, Entertainment: Film, Subscriptions: Plug, "Meta Ads": Megaphone,
  "Hosting & Domains": Globe, "Software & Tools": Wrench, "Freelancer Payments": Users, Salaries: Users, Marketing: Megaphone,
  "Client Project Costs": Package, "Office Expenses": Briefcase, "Client Payment": Briefcase, Salary: Banknote, Freelance: Sparkles,
  Interest: Percent, Transfer: ArrowLeftRight, "Card Payment": CreditCard, Loan: Landmark, Refund: Undo2, Adjustment: RotateCcw,
  "Business Revenue": Briefcase, Fitness: Dumbbell, "Other Income": Gift,
};

export function CategoryIcon({ category, className }: { category: string; className?: string }) {
  const Icon = CAT_ICONS[category] ?? Receipt;
  return (
    <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl bg-secondary text-secondary-foreground", className)}>
      <Icon className="size-4" />
    </span>
  );
}

export const TYPE_LABEL: Record<Transaction["type"], string> = {
  income: "Income", expense: "Expense", transfer: "Transfer", refund: "Refund", loan_disbursement: "Loan received",
  loan_repayment: "Loan repayment", cc_payment: "Card payment", adjustment: "Adjustment",
};

export function signOf(t: Transaction): 1 | -1 | 0 {
  if (t.type === "income" || t.type === "refund" || t.type === "loan_disbursement") return 1;
  if (t.type === "transfer" || t.type === "cc_payment") return 0;
  if (t.type === "adjustment") return t.adjustmentSign ?? 1;
  return -1;
}

export function Amount({ t, className }: { t: Transaction; className?: string }) {
  const s = signOf(t);
  return (
    <span className={cn("num font-semibold", s > 0 && "text-positive", s === 0 && "text-muted-foreground", className)}>
      {s > 0 ? "+" : s < 0 ? "−" : ""}
      {formatINR(t.amount)}
    </span>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="font-display text-3xl font-medium sm:text-4xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Panel({ title, action, children, className }: { title?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("surface min-w-0 p-4 sm:p-5", className)}>
      {title && (
        <div className="mb-4 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function StatCard({ label, value, prev, icon: Icon, tone = "neutral", invert, hint }: {
  label: string; value: number; prev?: number; icon: LucideIcon; tone?: "positive" | "negative" | "neutral" | "warning"; invert?: boolean; hint?: string;
}) {
  const ch = prev !== undefined ? pctChange(value, prev) : null;
  const good = ch === null ? null : invert ? ch <= 0 : ch >= 0;
  return (
    <div className="surface group min-w-0 p-4 transition-shadow hover:shadow-lift">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <span className={cn("grid size-8 place-items-center rounded-lg",
          tone === "positive" && "bg-positive-soft text-positive",
          tone === "negative" && "bg-negative-soft text-negative",
          tone === "warning" && "bg-warning-soft text-warning",
          tone === "neutral" && "bg-secondary text-foreground")}>
          <Icon className="size-4" />
        </span>
      </div>
      <div className="num mt-3 text-2xl font-semibold">{formatINR(value)}</div>
      <div className="mt-1 h-4 text-xs">
        {ch !== null ? (
          <span className={cn("inline-flex items-center gap-0.5 font-medium", good ? "text-positive" : "text-negative")}>
            {ch >= 0 ? <ArrowUpRight className="size-3" /> : <ArrowDownLeft className="size-3" />}
            {Math.abs(ch).toFixed(0)}% <span className="font-normal text-muted-foreground">vs previous period</span>
          </span>
        ) : (
          <span className="text-muted-foreground">{hint}</span>
        )}
      </div>
    </div>
  );
}

export function Progress({ value, tone }: { value: number; tone?: "positive" | "warning" | "negative" }) {
  const v = Math.min(100, Math.max(0, value));
  const t = tone ?? (value >= 100 ? "negative" : value >= 80 ? "warning" : "positive");
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
      <div className={cn("h-full rounded-full transition-all duration-500", t === "positive" && "bg-positive", t === "warning" && "bg-warning", t === "negative" && "bg-negative")} style={{ width: `${v}%` }} />
    </div>
  );
}

export function Pill({ children, tone = "neutral", className }: { children: ReactNode; tone?: "positive" | "negative" | "warning" | "info" | "neutral" | "primary"; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
      tone === "positive" && "bg-positive-soft text-positive",
      tone === "negative" && "bg-negative-soft text-negative",
      tone === "warning" && "bg-warning-soft text-warning",
      tone === "info" && "bg-info-soft text-info",
      tone === "primary" && "bg-primary-soft text-primary",
      tone === "neutral" && "bg-secondary text-muted-foreground", className)}>
      {children}
    </span>
  );
}

export function EmptyState({ icon: Icon = Wallet, title, text, action }: { icon?: LucideIcon; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
      <span className="grid size-12 place-items-center rounded-2xl bg-secondary"><Icon className="size-5 text-muted-foreground" /></span>
      <p className="font-medium">{title}</p>
      {text && <p className="max-w-xs text-sm text-muted-foreground">{text}</p>}
      {action}
    </div>
  );
}

export const CHART_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "var(--muted-foreground)"];

export const tooltipStyle = {
  contentStyle: { background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 12, fontSize: 12, boxShadow: "var(--shadow-lift-v)" },
  labelStyle: { color: "var(--muted-foreground)" },
  itemStyle: { color: "var(--foreground)" },
};

export { ArrowUpRight, ArrowDownLeft };
