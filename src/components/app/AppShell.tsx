import { useState, type ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  ArrowDownToLine, ArrowUpFromLine, BarChart3, ChevronsLeft, FileScan, Landmark, LayoutDashboard, ListOrdered, Menu, Plus,
  Settings, Sparkles, Target, Wallet, type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useFinance } from "@/lib/finance/store";
import { useAuth } from "@/lib/auth/session";
import { LogOut } from "lucide-react";
import type { WorkspaceFilter } from "@/lib/finance/types";
import { cn } from "@/lib/utils";
import { AddTransactionDialog } from "./AddTransaction";
import { AssistantChat } from "./Assistant";

type To = "/" | "/transactions" | "/money-in" | "/money-out" | "/accounts" | "/loans" | "/statement-studio" | "/analytics" | "/budgets" | "/settings" | "/assistant";
const NAV: { to: To; label: string; icon: LucideIcon }[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/transactions", label: "Transactions", icon: ListOrdered },
  { to: "/money-in", label: "Money In", icon: ArrowDownToLine },
  { to: "/money-out", label: "Money Out", icon: ArrowUpFromLine },
  { to: "/accounts", label: "Accounts", icon: Wallet },
  { to: "/loans", label: "Loans & Dues", icon: Landmark },
  { to: "/statement-studio", label: "AI Statement Studio", icon: FileScan },
  { to: "/analytics", label: "Analytics", icon: BarChart3 },
  { to: "/budgets", label: "Budgets & Goals", icon: Target },
  { to: "/settings", label: "Settings", icon: Settings },
];
const MOBILE: To[] = ["/", "/transactions", "/accounts", "/analytics"];

function Logo({ small }: { small?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground">
        <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 18V7l8 6 8-6v11" /></svg>
      </span>
      {!small && <div className="leading-tight"><div className="font-display text-lg font-semibold">Money Hub</div><div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-primary">AI · {mode === "production" ? "Live" : "Preview"}</div></div>}
    </div>
  );
}

export function WorkspaceSwitcher({ className }: { className?: string }) {
  const { workspace, setWorkspace } = useFinance();
  const opts: { v: WorkspaceFilter; l: string }[] = [{ v: "all", l: "All" }, { v: "personal", l: "Personal" }, { v: "scaleflow", l: "Scale Flow" }];
  return (
    <div role="radiogroup" aria-label="Workspace" className={cn("inline-flex rounded-xl bg-secondary p-1", className)}>
      {opts.map((o) => (
        <button key={o.v} role="radio" aria-checked={workspace === o.v} onClick={() => setWorkspace(o.v)}
          className={cn("rounded-lg px-3 py-1.5 text-xs font-semibold transition-all", workspace === o.v ? "bg-card text-foreground shadow-card" : "text-muted-foreground hover:text-foreground")}>
          {o.l}
        </button>
      ))}
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const { openAdd } = useFinance();
  const { mode, user, logout } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const [more, setMore] = useState(false);
  const [chat, setChat] = useState(false);
  const active = (to: string) => (to === "/" ? path === "/" : path.startsWith(to));

  return (
    <div className="min-h-screen overflow-x-clip">
      {/* Desktop sidebar */}
      <aside className={cn("fixed inset-y-0 left-0 z-30 hidden flex-col border-r bg-sidebar transition-[width] duration-300 lg:flex", collapsed ? "w-[76px]" : "w-64")}>
        <div className="flex h-16 items-center justify-between px-4">
          <Logo small={collapsed} />
          {!collapsed && <button onClick={() => setCollapsed(true)} className="rounded-lg p-1.5 text-muted-foreground hover:bg-sidebar-accent" aria-label="Collapse sidebar"><ChevronsLeft className="size-4" /></button>}
        </div>
        {collapsed && <button onClick={() => setCollapsed(false)} className="mx-auto mb-2 rounded-lg p-1.5 text-muted-foreground hover:bg-sidebar-accent" aria-label="Expand sidebar"><ChevronsLeft className="size-4 rotate-180" /></button>}
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-2">
          {NAV.map((n) => (
            <Link key={n.to} to={n.to} title={n.label}
              className={cn("flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors", collapsed && "justify-center px-0",
                active(n.to) ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground")}>
              <n.icon className={cn("size-[18px] shrink-0", active(n.to) && "text-primary")} />
              {!collapsed && <span className="truncate">{n.label}</span>}
            </Link>
          ))}
        </nav>
        <div className="p-3">
          <button onClick={() => setChat(true)} className={cn("flex w-full items-center gap-3 rounded-xl border bg-card p-3 text-left transition-shadow hover:shadow-lift", collapsed && "justify-center")}>
            <span className="grid size-8 place-items-center rounded-lg bg-primary-soft text-primary"><Sparkles className="size-4" /></span>
            {!collapsed && <div><div className="text-sm font-semibold">Ask Money Hub</div><div className="text-xs text-muted-foreground">Financial assistant</div></div>}
          </button>
        </div>
      </aside>

      <div className={cn("transition-[padding] duration-300", collapsed ? "lg:pl-[76px]" : "lg:pl-64")}>
        <header className="sticky top-0 z-20 border-b bg-background/85 backdrop-blur">
          <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6">
            <div className="lg:hidden"><Logo small /></div>
            <WorkspaceSwitcher />
            <div className="flex items-center gap-2">
              {mode === "preview" ? (
                <span className="hidden rounded-full bg-warning-soft px-2.5 py-1 text-[11px] font-semibold text-warning sm:inline">Preview Mode · demo data</span>
              ) : (
                <>
                  <span className="hidden max-w-[180px] truncate rounded-full bg-primary-soft px-2.5 py-1 text-[11px] font-semibold text-primary sm:inline" title={user?.email}>Live · {user?.name || user?.email}</span>
                  <Button variant="ghost" size="icon" aria-label="Sign out" onClick={() => void logout()}><LogOut className="size-4" /></Button>
                </>
              )}
              <Button onClick={() => openAdd()} className="hidden sm:inline-flex"><Plus className="size-4" />Add Transaction</Button>
            </div>
          </div>
        </header>
        <main key={path} className="page-enter mx-auto max-w-7xl px-4 pb-28 pt-6 sm:px-6 lg:pb-12">{children}</main>
      </div>

      {/* Desktop floating assistant */}
      <button onClick={() => setChat(true)} aria-label="Open assistant" className="fixed bottom-6 right-6 z-30 hidden size-12 place-items-center rounded-full bg-foreground text-background shadow-lift transition-transform hover:scale-105 lg:grid">
        <Sparkles className="size-5" />
      </button>

      {/* Mobile FAB + bottom nav */}
      <button onClick={() => openAdd()} aria-label="Add transaction" className="fixed bottom-20 right-4 z-30 grid size-14 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-lift lg:hidden">
        <Plus className="size-6" />
      </button>
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
        <div className="grid grid-cols-5">
          {MOBILE.map((to) => {
            const n = NAV.find((x) => x.to === to)!;
            return (
              <Link key={to} to={to} className={cn("flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium", active(to) ? "text-primary" : "text-muted-foreground")}>
                <n.icon className="size-5" />{n.label.split(" ")[0]}
              </Link>
            );
          })}
          <button onClick={() => setMore(true)} className="flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium text-muted-foreground"><Menu className="size-5" />More</button>
        </div>
      </nav>

      <Sheet open={more} onOpenChange={setMore}>
        <SheetContent side="bottom" className="rounded-t-3xl">
          <SheetHeader><SheetTitle className="font-display text-xl">More</SheetTitle></SheetHeader>
          <div className="grid grid-cols-3 gap-2 p-4 pt-0">
            {[...NAV.filter((n) => !MOBILE.includes(n.to)), { to: "/assistant" as To, label: "Assistant", icon: Sparkles }].map((n) => (
              <Link key={n.to} to={n.to} onClick={() => setMore(false)} className="flex flex-col items-center gap-2 rounded-2xl border bg-card p-3 text-center text-xs font-medium">
                <n.icon className="size-5 text-primary" />{n.label}
              </Link>
            ))}
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={chat} onOpenChange={setChat}>
        <SheetContent className="flex w-full flex-col sm:max-w-md">
          <SheetHeader><SheetTitle className="font-display text-xl">Ask Money Hub</SheetTitle></SheetHeader>
          <AssistantChat className="min-h-0 flex-1 px-4 pb-4" />
        </SheetContent>
      </Sheet>

      <AddTransactionDialog />
    </div>
  );
}
