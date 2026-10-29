import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ACCOUNTS, BUDGETS, GOALS, RULES, buildDemoTransactions, buildDues, buildRecurring } from "./data";
import type { Draft, Account, Budget, Due, Goal, Period, Recurring, Rule, Transaction, WorkspaceFilter } from "./types";

const KEY = "moneyhub-preview-v1";

interface State {
  txns: Transaction[];
  accounts: Account[];
  dues: Due[];
  budgets: Budget[];
  goals: Goal[];
  recurring: Recurring[];
  rules: Rule[];
  customCategories: string[];
}

function initial(): State {
  return {
    txns: buildDemoTransactions(),
    accounts: ACCOUNTS,
    dues: buildDues(),
    budgets: BUDGETS,
    goals: GOALS,
    recurring: buildRecurring(),
    rules: RULES,
    customCategories: [],
  };
}

interface Ctx extends State {
  workspace: WorkspaceFilter;
  setWorkspace: (w: WorkspaceFilter) => void;
  period: Period;
  setPeriod: (p: Period) => void;
  custom: { from: string; to: string };
  setCustom: (c: { from: string; to: string }) => void;
  addTxn: (t: Omit<Transaction, "id">) => void;
  addTxns: (t: Omit<Transaction, "id">[]) => void;
  updateTxn: (id: string, patch: Partial<Transaction>) => void;
  deleteTxns: (ids: string[]) => void;
  update: <K extends keyof State>(k: K, v: State[K]) => void;
  resetDemo: () => void;
  ready: boolean;
  dark: boolean;
  setDark: (d: boolean) => void;
  // UI
  addOpen: boolean;
  openAdd: (prefill?: Draft<Transaction>) => void;
  closeAdd: () => void;
  prefill: Draft<Transaction> | undefined;
  editing: Transaction | undefined;
  openEdit: (t: Transaction) => void;
}

const FinanceCtx = createContext<Ctx | null>(null);

export function FinanceProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>(initial);
  const [ready, setReady] = useState(false);
  const [workspace, setWorkspace] = useState<WorkspaceFilter>("all");
  const [period, setPeriod] = useState<Period>("month");
  const now = new Date();
  const [custom, setCustom] = useState({ from: new Date(now.getFullYear(), now.getMonth() - 2, 1).toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) });
  const [addOpen, setAddOpen] = useState(false);
  const [prefill, setPrefill] = useState<Draft<Transaction>>();
  const [editing, setEditing] = useState<Transaction>();
  const [dark, setDarkState] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setState({ ...initial(), ...JSON.parse(raw) });
      setDarkState(localStorage.getItem(KEY + "-dark") === "1");
    } catch {
      /* ignore corrupted preview data */
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (ready) localStorage.setItem(KEY, JSON.stringify(state));
  }, [state, ready]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  const setDark = (d: boolean) => {
    setDarkState(d);
    localStorage.setItem(KEY + "-dark", d ? "1" : "0");
  };

  const addTxns = useCallback((ts: Omit<Transaction, "id">[]) => {
    setState((s) => ({
      ...s,
      txns: [...ts.map((t) => ({ ...t, id: `u${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}` })), ...s.txns].sort((a, b) => b.date.localeCompare(a.date)),
    }));
  }, []);

  const value: Ctx = {
    ...state,
    workspace,
    setWorkspace,
    period,
    setPeriod,
    custom,
    setCustom,
    addTxn: (t) => addTxns([t]),
    addTxns,
    updateTxn: (id, patch) => setState((s) => ({ ...s, txns: s.txns.map((t) => (t.id === id ? { ...t, ...patch } : t)).sort((a, b) => b.date.localeCompare(a.date)) })),
    deleteTxns: (ids) => setState((s) => ({ ...s, txns: s.txns.filter((t) => !ids.includes(t.id)) })),
    update: (k, v) => setState((s) => ({ ...s, [k]: v })),
    resetDemo: () => setState(initial()),
    ready,
    dark,
    setDark,
    addOpen,
    openAdd: (p) => {
      setEditing(undefined);
      setPrefill(p);
      setAddOpen(true);
    },
    openEdit: (t) => {
      setEditing(t);
      setPrefill(undefined);
      setAddOpen(true);
    },
    closeAdd: () => setAddOpen(false),
    prefill,
    editing,
  };

  return <FinanceCtx.Provider value={value}>{children}</FinanceCtx.Provider>;
}

export function useFinance() {
  const c = useContext(FinanceCtx);
  if (!c) throw new Error("useFinance must be used inside FinanceProvider");
  return c;
}

/** Transactions in the current workspace filter. */
export function useScoped() {
  const f = useFinance();
  return useMemo(() => {
    const txns = f.workspace === "all" ? f.txns : f.txns.filter((t) => t.workspace === f.workspace);
    const accounts = f.workspace === "all" ? f.accounts : f.accounts.filter((a) => a.workspace === f.workspace);
    const dues = f.workspace === "all" ? f.dues : f.dues.filter((d) => d.workspace === f.workspace);
    return { txns, accounts, dues };
  }, [f.txns, f.accounts, f.dues, f.workspace]);
}
