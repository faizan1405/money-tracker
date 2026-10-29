import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ACCOUNTS, BUDGETS, GOALS, RULES, buildDemoTransactions, buildDues, buildRecurring } from "./data";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth/session";
import { ApiError } from "@/lib/api/client";
import { bootstrapApi, collectionsApi, transactionsApi } from "@/lib/api/services";
import type { AppMode } from "@/lib/api/config";
import type { CollectionKey } from "@/lib/api/contracts";
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

export function emptyState(): State {
  return { txns: [], accounts: [], dues: [], budgets: [], goals: [], recurring: [], rules: [], customCategories: [] };
}

export type DataStatus = "idle" | "loading" | "ready" | "error";

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
  mode: AppMode;
  dataStatus: DataStatus;
  dataError: ApiError | null;
  reload: () => void;
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
  const { mode, modeReady, status } = useAuth();
  const prod = mode === "production";
  const [state, setState] = useState<State>(initial);
  const [ready, setReady] = useState(false);
  const [dataStatus, setDataStatus] = useState<DataStatus>("idle");
  const [dataError, setDataError] = useState<ApiError | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [workspace, setWorkspace] = useState<WorkspaceFilter>("all");
  const [period, setPeriod] = useState<Period>("month");
  const now = new Date();
  const [custom, setCustom] = useState({ from: new Date(now.getFullYear(), now.getMonth() - 2, 1).toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) });
  const [addOpen, setAddOpen] = useState(false);
  const [prefill, setPrefill] = useState<Draft<Transaction>>();
  const [editing, setEditing] = useState<Transaction>();
  const [dark, setDarkState] = useState(false);

  useEffect(() => {
    setDarkState(localStorage.getItem(KEY + "-dark") === "1");
  }, []);

  // Preview: load demo data from localStorage. Production: load only from the API — never demo data.
  useEffect(() => {
    if (!modeReady) return;
    setReady(false);
    if (!prod) {
      let next = initial();
      try {
        const raw = localStorage.getItem(KEY);
        if (raw) next = { ...next, ...JSON.parse(raw) };
      } catch {
        /* ignore corrupted preview data */
      }
      setState(next);
      setDataStatus("ready");
      setDataError(null);
      setReady(true);
      return;
    }
    setState(emptyState());
    if (status !== "signed_in") {
      setDataStatus("idle");
      return;
    }
    let cancelled = false;
    setDataStatus("loading");
    setDataError(null);
    bootstrapApi
      .load()
      .then((b) => {
        if (cancelled) return;
        setState({ txns: b.transactions, accounts: b.accounts, dues: b.dues, budgets: b.budgets, goals: b.goals, recurring: b.recurring, rules: b.rules, customCategories: b.customCategories });
        setDataStatus("ready");
        setReady(true);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setDataError(e instanceof ApiError ? e : new ApiError("network", "Couldn't load your data."));
        setDataStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [prod, modeReady, status, reloadKey]);

  useEffect(() => {
    if (ready && !prod) localStorage.setItem(KEY, JSON.stringify(state));
  }, [state, ready, prod]);

  const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : "Couldn't save to the server");

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  const setDark = (d: boolean) => {
    setDarkState(d);
    localStorage.setItem(KEY + "-dark", d ? "1" : "0");
  };

  const sortTx = (a: Transaction, b: Transaction) => b.date.localeCompare(a.date);
  const addTxns = useCallback((ts: Omit<Transaction, "id">[]) => {
    if (prod) {
      transactionsApi.createMany(ts).then((created) => setState((s) => ({ ...s, txns: [...created, ...s.txns].sort(sortTx) }))).catch(fail);
      return;
    }
    setState((s) => ({
      ...s,
      txns: [...ts.map((t) => ({ ...t, id: `u${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}` })), ...s.txns].sort((a, b) => b.date.localeCompare(a.date)),
    }));
  }, [prod]);

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
    updateTxn: (id, patch) => prod
      ? void transactionsApi.update(id, patch).then((t) => setState((s) => ({ ...s, txns: s.txns.map((x) => (x.id === id ? t : x)).sort(sortTx) }))).catch(fail)
      : setState((s) => ({ ...s, txns: s.txns.map((t) => (t.id === id ? { ...t, ...patch } : t)).sort((a, b) => b.date.localeCompare(a.date)) })),
    deleteTxns: (ids) => prod
      ? void transactionsApi.remove(ids).then(() => setState((s) => ({ ...s, txns: s.txns.filter((t) => !ids.includes(t.id)) }))).catch(fail)
      : setState((s) => ({ ...s, txns: s.txns.filter((t) => !ids.includes(t.id)) })),
    update: (k, v) => {
      if (prod) {
        if (k === "txns") return;
        void collectionsApi.replace(k as CollectionKey, v).then(() => setState((s) => ({ ...s, [k]: v }))).catch(fail);
        return;
      }
      setState((s) => ({ ...s, [k]: v }));
    },
    resetDemo: () => {
      if (!prod) setState(initial());
    },
    ready,
    mode,
    dataStatus,
    dataError,
    reload: () => setReloadKey((n) => n + 1),
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
