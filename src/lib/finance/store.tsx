import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
  /** All mutations resolve true only after the change is really saved (instantly in Preview, after the server confirms in Production). */
  addTxn: (t: Omit<Transaction, "id">) => Promise<boolean>;
  addTxns: (t: Omit<Transaction, "id">[]) => Promise<boolean>;
  updateTxn: (id: string, patch: Partial<Transaction>) => Promise<boolean>;
  deleteTxns: (ids: string[]) => Promise<boolean>;
  update: <K extends keyof State>(k: K, v: State[K]) => Promise<boolean>;
  saving: boolean;
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
  const inflight = useRef(new Set<string>());
  const [savingCount, setSavingCount] = useState(0);

  /** Runs a server write once: identical requests already in flight (double clicks) are ignored. */
  const run = useCallback(async (key: string, op: () => Promise<void>) => {
    if (inflight.current.has(key)) return false;
    inflight.current.add(key);
    setSavingCount((n) => n + 1);
    try {
      await op();
      return true;
    } catch (e) {
      fail(e);
      return false;
    } finally {
      inflight.current.delete(key);
      setSavingCount((n) => n - 1);
    }
  }, []);

  const addTxns = useCallback(async (ts: Omit<Transaction, "id">[]) => {
    if (prod) {
      return run(`add:${JSON.stringify(ts)}`, async () => {
        const created = await transactionsApi.createMany(ts);
        setState((s) => ({ ...s, txns: [...created, ...s.txns].sort(sortTx) }));
      });
    }
    setState((s) => ({
      ...s,
      txns: [...ts.map((t) => ({ ...t, id: `u${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}` })), ...s.txns].sort(sortTx),
    }));
    return true;
  }, [prod, run]);

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
    updateTxn: async (id, patch) => {
      if (prod) {
        return run(`upd:${id}:${JSON.stringify(patch)}`, async () => {
          const t = await transactionsApi.update(id, patch);
          setState((s) => ({ ...s, txns: s.txns.map((x) => (x.id === id ? t : x)).sort(sortTx) }));
        });
      }
      setState((s) => ({ ...s, txns: s.txns.map((t) => (t.id === id ? { ...t, ...patch } : t)).sort(sortTx) }));
      return true;
    },
    deleteTxns: async (ids) => {
      if (prod) {
        return run(`del:${ids.join(",")}`, async () => {
          await transactionsApi.remove(ids);
          setState((s) => ({ ...s, txns: s.txns.filter((t) => !ids.includes(t.id)) }));
        });
      }
      setState((s) => ({ ...s, txns: s.txns.filter((t) => !ids.includes(t.id)) }));
      return true;
    },
    update: async (k, v) => {
      if (prod) {
        if (k === "txns") return false;
        return run(`col:${String(k)}:${JSON.stringify(v)}`, async () => {
          const saved = await collectionsApi.replace(k as CollectionKey, v);
          setState((s) => ({ ...s, [k]: saved ?? v }));
        });
      }
      setState((s) => ({ ...s, [k]: v }));
      return true;
    },
    saving: savingCount > 0,
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
