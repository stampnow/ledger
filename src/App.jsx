import React, { useState, useEffect, useMemo } from "react";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, ReferenceLine, Cell,
} from "recharts";
import {
  Plus, Trash2, X, BookOpen, BarChart3, Settings2, AlertTriangle,
  TrendingUp, Layers, Search, ChevronRight, Database,
} from "lucide-react";
import storage from "./storage.js";

/* ============================================================
   LEDGER — Trading Journal
   Kernprinzipien:
   - Zielgröße = Expectancy (Ø R/Trade), nicht Winrate.
   - Kriterien sind TYPISIERT: numeric / categorical / note.
     'note' ist bewusst aus jeder Statistik ausgeschlossen.
   - Der Analyzer zeigt NIE eine nackte Winrate: immer mit n
     und Wilson-Konfidenzintervall, kleine Stichproben werden
     abgewertet und markiert (Overfitting-Schutz).
   - Persistenz lokal im Browser (localStorage, siehe storage.js).
   ============================================================ */

const STORAGE_KEY = "ledger_journal_data_v1";
const uid = () => Math.random().toString(36).slice(2, 10);

/* ---------- Statistik-Helfer ---------- */

// Wilson-Konfidenzintervall für eine Trefferquote
export function wilson(pos, n, z = 1.96) {
  if (n === 0) return [0, 0];
  const p = pos / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const m = (z / d) * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, c - m), Math.min(1, c + m)];
}

export function computeStats(trades) {
  const sorted = [...trades].sort(
    (a, b) => new Date(a.date) - new Date(b.date) || (a.createdAt - b.createdAt)
  );
  const n = sorted.length;
  const rs = sorted.map((t) => Number(t.r) || 0);
  const wins = rs.filter((r) => r > 0);
  const losses = rs.filter((r) => r < 0);
  const nWin = wins.length;
  const sumR = rs.reduce((a, b) => a + b, 0);
  const grossWin = wins.reduce((a, b) => a + b, 0);
  const grossLoss = Math.abs(losses.reduce((a, b) => a + b, 0));

  let peak = 0, eq = 0, maxDD = 0;
  const curve = [{ i: 0, eq: 0 }];
  sorted.forEach((t, i) => {
    eq += Number(t.r) || 0;
    peak = Math.max(peak, eq);
    maxDD = Math.min(maxDD, eq - peak);
    curve.push({ i: i + 1, eq: +eq.toFixed(2), label: t.symbol || "" });
  });

  // R-Verteilung als Histogramm
  const bins = [
    { key: "≤-2", lo: -Infinity, hi: -2 },
    { key: "-2..-1", lo: -2, hi: -1 },
    { key: "-1..0", lo: -1, hi: 0 },
    { key: "0..1", lo: 0, hi: 1 },
    { key: "1..2", lo: 1, hi: 2 },
    { key: "2..3", lo: 2, hi: 3 },
    { key: "≥3", lo: 3, hi: Infinity },
  ].map((b) => ({
    ...b,
    count: rs.filter((r) => r > b.lo && r <= b.hi).length,
  }));

  const [ciLo, ciHi] = wilson(nWin, n);

  return {
    n,
    winrate: n ? nWin / n : 0,
    winrateCI: [ciLo, ciHi],
    expectancy: n ? sumR / n : 0,
    sumR,
    avgWin: nWin ? grossWin / nWin : 0,
    avgLoss: losses.length ? losses.reduce((a, b) => a + b, 0) / losses.length : 0,
    profitFactor: grossLoss ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
    maxDD,
    curve,
    bins,
  };
}

// Terzil-Bucketing für numerische Kriterien
function bucketNumeric(values) {
  const nums = values.filter((v) => v !== "" && v != null).map(Number).sort((a, b) => a - b);
  if (nums.length < 3) return null;
  const q = (p) => nums[Math.floor(p * (nums.length - 1))];
  const t1 = q(1 / 3), t2 = q(2 / 3);
  return {
    label: (v) => (v <= t1 ? `≤${round(t1)}` : v <= t2 ? `${round(t1)}–${round(t2)}` : `>${round(t2)}`),
  };
}

const round = (x) => (Math.abs(x) >= 10 ? Math.round(x) : Math.round(x * 100) / 100);

/* Analyzer: findet Segmente (einzeln + optional 2-fach-Kombis),
   gewichtet nach Expectancy, mit n und Wilson-CI. */
export function analyze(trades, criteria, { combos }) {
  const statCriteria = criteria.filter((c) => c.includeInStats && c.type !== "note");
  const segments = [];

  const bucketers = {};
  statCriteria.forEach((c) => {
    if (c.type === "numeric") {
      bucketers[c.id] = bucketNumeric(trades.map((t) => t.values?.[c.id]));
    }
  });

  const valueOf = (t, c) => {
    const raw = t.values?.[c.id];
    if (raw === "" || raw == null) return null;
    if (c.type === "numeric") {
      const b = bucketers[c.id];
      return b ? b.label(Number(raw)) : null;
    }
    return String(raw);
  };

  const build = (defs) => {
    const groups = {};
    trades.forEach((t) => {
      const parts = [];
      for (const c of defs) {
        const v = valueOf(t, c);
        if (v == null) return;
        parts.push(`${c.name}: ${v}`);
      }
      const key = parts.join("  ·  ");
      (groups[key] ||= []).push(t);
    });
    Object.entries(groups).forEach(([label, ts]) => {
      const s = computeStats(ts);
      segments.push({
        label,
        depth: defs.length,
        n: s.n,
        winrate: s.winrate,
        ci: s.winrateCI,
        expectancy: s.expectancy,
        sumR: s.sumR,
      });
    });
  };

  statCriteria.forEach((c) => build([c]));
  if (combos) {
    for (let i = 0; i < statCriteria.length; i++)
      for (let j = i + 1; j < statCriteria.length; j++)
        build([statCriteria[i], statCriteria[j]]);
  }

  // Reliabilitäts-gewichtete Sortierung: Expectancy, aber n dämpft.
  // score = expectancy * shrink(n)  mit shrink→1 ab ~30 Trades
  const shrink = (n) => n / (n + 12);
  return segments
    .filter((s) => s.n >= 2)
    .map((s) => ({ ...s, score: s.expectancy * shrink(s.n) }))
    .sort((a, b) => b.score - a.score);
}

/* ---------- kleine UI-Bausteine ---------- */
const fmt = (x, d = 2) =>
  x === Infinity ? "∞" : Number.isFinite(x) ? x.toFixed(d) : "–";
const pct = (x) => `${(x * 100).toFixed(0)}%`;

function Metric({ label, value, sub, tone }) {
  const c = tone === "pos" ? "text-emerald-400" : tone === "neg" ? "text-rose-400" : "text-zinc-100";
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-3">
      <div className="text-[11px] uppercase tracking-wider text-zinc-500">{label}</div>
      <div className={`mt-1 font-mono text-2xl ${c}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-zinc-500">{sub}</div>}
    </div>
  );
}

/* ============================================================
   Haupt-Komponente
   ============================================================ */
export default function App() {
  const [data, setData] = useState({ journals: [], trades: [] });
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("journal"); // journal | stats
  const [activeId, setActiveId] = useState(null);
  const [scope, setScope] = useState("all"); // journalId | 'all' (nur Stats)
  const [showCriteria, setShowCriteria] = useState(false);
  const [combos, setCombos] = useState(false);
  const [ran, setRan] = useState(false);

  /* Laden */
  useEffect(() => {
    (async () => {
      try {
        const r = await storage.get(STORAGE_KEY);
        if (r && r.value) {
          const parsed = JSON.parse(r.value);
          setData(parsed);
          setActiveId(parsed.journals[0]?.id ?? null);
        }
      } catch (e) { /* Key existiert noch nicht */ }
      setLoading(false);
    })();
  }, []);

  /* Speichern */
  useEffect(() => {
    if (loading) return;
    storage.set(STORAGE_KEY, JSON.stringify(data)).catch(() => {});
  }, [data, loading]);

  const journals = data.journals;
  const active = journals.find((j) => j.id === activeId) || null;

  /* ---------- Mutationen ---------- */
  const addJournal = () => {
    const j = { id: uid(), name: `Journal ${journals.length + 1}`, criteria: [] };
    setData((d) => ({ ...d, journals: [...d.journals, j] }));
    setActiveId(j.id);
    setShowCriteria(true);
  };
  const renameJournal = (id, name) =>
    setData((d) => ({ ...d, journals: d.journals.map((j) => (j.id === id ? { ...j, name } : j)) }));
  const deleteJournal = (id) =>
    setData((d) => ({
      journals: d.journals.filter((j) => j.id !== id),
      trades: d.trades.filter((t) => t.journalId !== id),
    }));

  const addCriterion = (jid, crit) =>
    setData((d) => ({
      ...d,
      journals: d.journals.map((j) =>
        j.id === jid ? { ...j, criteria: [...j.criteria, crit] } : j
      ),
    }));
  const removeCriterion = (jid, cid) =>
    setData((d) => ({
      ...d,
      journals: d.journals.map((j) =>
        j.id === jid ? { ...j, criteria: j.criteria.filter((c) => c.id !== cid) } : j
      ),
    }));

  const addTrade = (trade) => setData((d) => ({ ...d, trades: [...d.trades, trade] }));
  const removeTrade = (id) =>
    setData((d) => ({ ...d, trades: d.trades.filter((t) => t.id !== id) }));

  /* ---------- Demo-Daten (zeigt v.a. den Analyzer korrekt) ---------- */
  const loadDemo = () => {
    const crit = [
      { id: "ema", name: "EMA-Lage", type: "categorical", options: ["über", "unter", "am"], includeInStats: true },
      { id: "sess", name: "Session", type: "categorical", options: ["London", "New York", "Asia"], includeInStats: true },
      { id: "setup", name: "Setup", type: "categorical", options: ["SMC", "LIT", "Breakout"], includeInStats: true },
      { id: "rr", name: "RR-Ziel", type: "numeric", includeInStats: true },
      { id: "note", name: "Notiz", type: "note", includeInStats: false },
    ];
    const j = { id: "demo", name: "Demo — XAUUSD", criteria: crit };
    const pick = (a) => a[Math.floor(Math.random() * a.length)];
    const trades = [];
    for (let i = 0; i < 48; i++) {
      const sess = pick(["London", "New York", "Asia"]);
      const setup = pick(["SMC", "LIT", "Breakout"]);
      // eingebauter (schwacher) Edge: London+SMC besser, Asia+Breakout schlechter
      let base = 0.15;
      if (sess === "London" && setup === "SMC") base = 0.55;
      if (sess === "Asia" && setup === "Breakout") base = -0.35;
      const win = Math.random() < 0.42 + base * 0.3;
      const r = win ? 1 + Math.random() * 2.2 : -1 + Math.random() * 0.25;
      const dt = new Date(Date.now() - (48 - i) * 86400000 * 0.6);
      trades.push({
        id: uid(), journalId: "demo", createdAt: Date.now() + i,
        date: dt.toISOString().slice(0, 10), symbol: "XAUUSD",
        r: +r.toFixed(2),
        values: { ema: pick(["über", "unter", "am"]), sess, setup, rr: pick([1, 1.5, 2, 3]) },
      });
    }
    setData({ journals: [j], trades });
    setActiveId("demo");
    setScope("demo");
    setView("stats");
    setRan(false);
  };

  /* ---------- abgeleitet ---------- */
  const scopeTrades = useMemo(() => {
    if (scope === "all") return data.trades;
    return data.trades.filter((t) => t.journalId === scope);
  }, [data.trades, scope]);

  const stats = useMemo(() => computeStats(scopeTrades), [scopeTrades]);

  // Analyzer nutzt Kriterien des gewählten Journals; bei "alle" vereint nach id.
  const scopeCriteria = useMemo(() => {
    if (scope === "all") {
      const map = {};
      journals.forEach((j) => j.criteria.forEach((c) => (map[c.id] = c)));
      return Object.values(map);
    }
    return journals.find((j) => j.id === scope)?.criteria || [];
  }, [journals, scope]);

  const analysis = useMemo(
    () => (ran ? analyze(scopeTrades, scopeCriteria, { combos }) : null),
    [ran, scopeTrades, scopeCriteria, combos]
  );

  if (loading)
    return (
      <div className="flex h-full min-h-[420px] items-center justify-center bg-zinc-950 text-zinc-500">
        <div className="animate-pulse font-mono text-sm">Lade Journal …</div>
      </div>
    );

  return (
    <div className="min-h-screen w-full bg-zinc-950 font-sans text-zinc-200 antialiased">
      <div className="mx-auto max-w-6xl px-5 py-5">
        {/* Kopf */}
        <header className="mb-6 flex flex-wrap items-center gap-4 border-b border-white/[0.06] pb-4">
          <div className="flex items-center gap-2">
            <div className="grid h-8 w-8 place-items-center rounded bg-sky-400/10 text-sky-400">
              <TrendingUp size={17} />
            </div>
            <span className="font-mono text-lg font-semibold tracking-tight text-zinc-100">LEDGER</span>
          </div>
          <div className="flex rounded-lg border border-white/[0.06] bg-white/[0.02] p-0.5 text-sm">
            <button
              onClick={() => setView("journal")}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 transition ${view === "journal" ? "bg-white/[0.06] text-zinc-100" : "text-zinc-500 hover:text-zinc-300"}`}
            >
              <BookOpen size={14} /> Journal
            </button>
            <button
              onClick={() => { setView("stats"); if (scope === "all" && journals.length === 1) setScope(journals[0].id); }}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 transition ${view === "stats" ? "bg-white/[0.06] text-zinc-100" : "text-zinc-500 hover:text-zinc-300"}`}
            >
              <BarChart3 size={14} /> Statistiken
            </button>
          </div>
          <div className="ml-auto text-xs text-zinc-600">
            {data.trades.length} Trades · {journals.length} Journals
          </div>
        </header>

        {journals.length === 0 ? (
          <EmptyStart onCreate={addJournal} onDemo={loadDemo} />
        ) : view === "journal" ? (
          <JournalView
            journals={journals}
            active={active}
            activeId={activeId}
            setActiveId={setActiveId}
            addJournal={addJournal}
            renameJournal={renameJournal}
            deleteJournal={deleteJournal}
            trades={data.trades.filter((t) => t.journalId === activeId)}
            addTrade={addTrade}
            removeTrade={removeTrade}
            showCriteria={showCriteria}
            setShowCriteria={setShowCriteria}
            addCriterion={addCriterion}
            removeCriterion={removeCriterion}
          />
        ) : (
          <StatsView
            journals={journals}
            scope={scope}
            setScope={setScope}
            stats={stats}
            nTrades={scopeTrades.length}
            analysis={analysis}
            ran={ran}
            runAnalysis={() => setRan(true)}
            combos={combos}
            setCombos={setCombos}
            resetRan={() => setRan(false)}
            hasCriteria={scopeCriteria.some((c) => c.includeInStats && c.type !== "note")}
          />
        )}
      </div>
    </div>
  );
}

/* ---------- Empty ---------- */
function EmptyStart({ onCreate, onDemo }) {
  return (
    <div className="grid min-h-[380px] place-items-center">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-xl bg-white/[0.04] text-sky-400">
          <Layers size={22} />
        </div>
        <h2 className="text-lg font-medium text-zinc-100">Kein Journal vorhanden</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Leg ein Journal an und definiere deine Kriterien – oder lade Demo-Daten,
          um Statistiken und den Analyzer sofort zu sehen.
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <button onClick={onCreate} className="rounded-lg bg-sky-400 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-sky-300">
            Journal erstellen
          </button>
          <button onClick={onDemo} className="rounded-lg border border-white/[0.08] px-4 py-2 text-sm text-zinc-300 hover:bg-white/[0.03]">
            <Database size={14} className="mr-1 inline" /> Demo laden
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- Journal-Ansicht ---------- */
function JournalView(props) {
  const {
    journals, active, activeId, setActiveId, addJournal, renameJournal, deleteJournal,
    trades, addTrade, removeTrade, showCriteria, setShowCriteria, addCriterion, removeCriterion,
  } = props;

  return (
    <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
      {/* Sidebar */}
      <aside className="space-y-1.5">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[11px] uppercase tracking-wider text-zinc-500">Journals</span>
          <button onClick={addJournal} className="text-zinc-500 hover:text-sky-400"><Plus size={16} /></button>
        </div>
        {journals.map((j) => (
          <button
            key={j.id}
            onClick={() => setActiveId(j.id)}
            className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition ${
              j.id === activeId ? "bg-white/[0.06] text-zinc-100" : "text-zinc-400 hover:bg-white/[0.03]"
            }`}
          >
            <span className="truncate">{j.name}</span>
            <ChevronRight size={14} className="shrink-0 text-zinc-600" />
          </button>
        ))}
      </aside>

      {/* Main */}
      {active && (
        <main className="space-y-4">
          <div className="flex items-center gap-2">
            <input
              value={active.name}
              onChange={(e) => renameJournal(active.id, e.target.value)}
              className="flex-1 rounded-lg border border-transparent bg-transparent px-1 py-1 text-xl font-medium text-zinc-100 outline-none hover:border-white/[0.06] focus:border-sky-400/40 focus:bg-white/[0.02]"
            />
            <button onClick={() => setShowCriteria(true)} className="flex items-center gap-1.5 rounded-lg border border-white/[0.08] px-3 py-1.5 text-sm text-zinc-300 hover:bg-white/[0.03]">
              <Settings2 size={14} /> Kriterien ({active.criteria.length})
            </button>
            <button onClick={() => deleteJournal(active.id)} className="rounded-lg border border-white/[0.08] px-2.5 py-1.5 text-rose-400/70 hover:bg-rose-500/10 hover:text-rose-400">
              <Trash2 size={14} />
            </button>
          </div>

          <TradeForm journal={active} onAdd={addTrade} />
          <TradeList trades={trades} criteria={active.criteria} onRemove={removeTrade} />
        </main>
      )}

      {showCriteria && active && (
        <CriteriaModal
          journal={active}
          onClose={() => setShowCriteria(false)}
          addCriterion={addCriterion}
          removeCriterion={removeCriterion}
        />
      )}
    </div>
  );
}

/* ---------- Trade-Eingabe (dynamisch nach Kriterien) ---------- */
function TradeForm({ journal, onAdd }) {
  const blank = () => ({
    date: new Date().toISOString().slice(0, 10),
    symbol: "",
    r: "",
    values: {},
  });
  const [f, setF] = useState(blank);

  const setVal = (cid, v) => setF((s) => ({ ...s, values: { ...s.values, [cid]: v } }));

  const submit = () => {
    if (f.r === "" || isNaN(Number(f.r))) return;
    onAdd({
      id: uid(), journalId: journal.id, createdAt: Date.now(),
      date: f.date, symbol: f.symbol.trim(), r: Number(f.r), values: { ...f.values },
    });
    setF(blank());
  };

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
      <div className="mb-3 text-[11px] uppercase tracking-wider text-zinc-500">Neuer Trade</div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="Datum">
          <input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} className={inp} />
        </Field>
        <Field label="Symbol">
          <input value={f.symbol} onChange={(e) => setF({ ...f, symbol: e.target.value })} placeholder="XAUUSD" className={inp} />
        </Field>
        <Field label="Ergebnis (R)" hint="+/-, Kernmetrik">
          <input value={f.r} onChange={(e) => setF({ ...f, r: e.target.value })} placeholder="z.B. 2 oder -1" className={`${inp} font-mono`} />
        </Field>
        <div />
        {journal.criteria.map((c) => (
          <Field key={c.id} label={c.name} hint={c.type === "note" ? "nicht in Statistik" : undefined}>
            {c.type === "categorical" ? (
              <select value={f.values[c.id] ?? ""} onChange={(e) => setVal(c.id, e.target.value)} className={inp}>
                <option value="">–</option>
                {(c.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : c.type === "numeric" ? (
              <input value={f.values[c.id] ?? ""} onChange={(e) => setVal(c.id, e.target.value)} className={`${inp} font-mono`} placeholder="0" />
            ) : (
              <input value={f.values[c.id] ?? ""} onChange={(e) => setVal(c.id, e.target.value)} className={inp} placeholder="Notiz …" />
            )}
          </Field>
        ))}
      </div>
      <div className="mt-3 flex justify-end">
        <button onClick={submit} className="rounded-lg bg-sky-400 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-sky-300">
          Trade hinzufügen
        </button>
      </div>
    </div>
  );
}

const inp = "w-full rounded-md border border-white/[0.08] bg-zinc-900/60 px-2.5 py-1.5 text-sm text-zinc-100 outline-none focus:border-sky-400/50";

function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center gap-1 text-xs text-zinc-400">
        {label}
        {hint && <span className="text-[10px] text-zinc-600">· {hint}</span>}
      </span>
      {children}
    </label>
  );
}

/* ---------- Trade-Liste ---------- */
function TradeList({ trades, criteria, onRemove }) {
  const cols = criteria.filter((c) => c.type !== "note");
  const sorted = [...trades].sort((a, b) => new Date(b.date) - new Date(a.date) || b.createdAt - a.createdAt);
  if (!trades.length)
    return <div className="rounded-xl border border-dashed border-white/[0.08] py-10 text-center text-sm text-zinc-600">Noch keine Trades. Der erste zählt.</div>;
  return (
    <div className="overflow-x-auto rounded-xl border border-white/[0.06]">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-white/[0.06] text-left text-[11px] uppercase tracking-wider text-zinc-500">
            <th className="px-3 py-2 font-medium">Datum</th>
            <th className="px-3 py-2 font-medium">Symbol</th>
            <th className="px-3 py-2 text-right font-medium">R</th>
            {cols.map((c) => <th key={c.id} className="px-3 py-2 font-medium">{c.name}</th>)}
            <th className="w-8" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((t) => (
            <tr key={t.id} className="border-b border-white/[0.03] last:border-0 hover:bg-white/[0.02]">
              <td className="px-3 py-2 text-zinc-400">{t.date}</td>
              <td className="px-3 py-2 text-zinc-300">{t.symbol || "–"}</td>
              <td className={`px-3 py-2 text-right font-mono ${t.r > 0 ? "text-emerald-400" : t.r < 0 ? "text-rose-400" : "text-zinc-500"}`}>
                {t.r > 0 ? "+" : ""}{fmt(t.r)}
              </td>
              {cols.map((c) => <td key={c.id} className="px-3 py-2 text-zinc-400">{t.values?.[c.id] ?? "–"}</td>)}
              <td className="px-2">
                <button onClick={() => onRemove(t.id)} className="text-zinc-600 hover:text-rose-400"><X size={14} /></button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------- Kriterien-Modal ---------- */
function CriteriaModal({ journal, onClose, addCriterion, removeCriterion }) {
  const [name, setName] = useState("");
  const [type, setType] = useState("categorical");
  const [optText, setOptText] = useState("");

  const add = () => {
    if (!name.trim()) return;
    const crit = {
      id: uid(),
      name: name.trim(),
      type,
      includeInStats: type !== "note",
      ...(type === "categorical"
        ? { options: optText.split(",").map((s) => s.trim()).filter(Boolean) }
        : {}),
    };
    if (type === "categorical" && crit.options.length === 0) return;
    addCriterion(journal.id, crit);
    setName(""); setOptText("");
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl border border-white/[0.08] bg-zinc-900 p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-medium text-zinc-100">Kriterien · {journal.name}</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200"><X size={18} /></button>
        </div>

        <div className="mb-4 space-y-2">
          {journal.criteria.length === 0 && <p className="text-sm text-zinc-500">Noch keine Kriterien definiert.</p>}
          {journal.criteria.map((c) => (
            <div key={c.id} className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-sm">
              <span className="font-medium text-zinc-200">{c.name}</span>
              <span className={`rounded px-1.5 py-0.5 text-[10px] ${
                c.type === "note" ? "bg-zinc-700/40 text-zinc-400" : "bg-sky-400/10 text-sky-300"
              }`}>
                {c.type === "categorical" ? "Dropdown" : c.type === "numeric" ? "numerisch" : "Notiz (nur Text)"}
              </span>
              {c.options && <span className="truncate text-xs text-zinc-500">{c.options.join(" · ")}</span>}
              <button onClick={() => removeCriterion(journal.id, c.id)} className="ml-auto text-zinc-600 hover:text-rose-400"><Trash2 size={14} /></button>
            </div>
          ))}
        </div>

        <div className="space-y-3 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
          <div className="grid grid-cols-2 gap-2">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Kriterium, z.B. EMA-Lage" className={inp} />
            <select value={type} onChange={(e) => setType(e.target.value)} className={inp}>
              <option value="categorical">Dropdown (auswählbar, analysierbar)</option>
              <option value="numeric">Numerisch (analysierbar)</option>
              <option value="note">Notiz / Freitext (nur Doku)</option>
            </select>
          </div>
          {type === "categorical" && (
            <input value={optText} onChange={(e) => setOptText(e.target.value)} placeholder="Optionen, kommagetrennt: über, unter, am" className={inp} />
          )}
          {type === "note" && (
            <p className="text-xs text-zinc-500">Freitext wird bewusst <span className="text-zinc-300">nicht</span> in Winrate/Analyzer einbezogen – sonst entsteht Datenmüll (siehe „ema bounce" ≠ „EMA bounce").</p>
          )}
          <button onClick={add} className="w-full rounded-lg bg-sky-400/90 px-3 py-2 text-sm font-medium text-zinc-950 hover:bg-sky-300">
            <Plus size={14} className="mr-1 inline" /> Kriterium hinzufügen
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- Statistik-Ansicht ---------- */
function StatsView(props) {
  const { journals, scope, setScope, stats, nTrades, analysis, ran, runAnalysis, combos, setCombos, resetRan, hasCriteria } = props;
  const s = stats;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] uppercase tracking-wider text-zinc-500">Ansicht für</span>
        <select
          value={scope}
          onChange={(e) => { setScope(e.target.value); resetRan(); }}
          className="rounded-lg border border-white/[0.08] bg-zinc-900/60 px-3 py-1.5 text-sm text-zinc-100 outline-none focus:border-sky-400/50"
        >
          <option value="all">Alle Journals zusammen</option>
          {journals.map((j) => <option key={j.id} value={j.id}>{j.name}</option>)}
        </select>
      </div>

      {nTrades === 0 ? (
        <div className="rounded-xl border border-dashed border-white/[0.08] py-14 text-center text-sm text-zinc-600">
          Keine Trades in dieser Auswahl.
        </div>
      ) : (
        <>
          {/* Kennzahlen */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Metric label="Trades" value={s.n} />
            <Metric label="Expectancy" value={`${s.expectancy >= 0 ? "+" : ""}${fmt(s.expectancy)}R`} tone={s.expectancy >= 0 ? "pos" : "neg"} sub="Ø R / Trade" />
            <Metric label="Winrate" value={pct(s.winrate)} sub={`95% CI ${pct(s.winrateCI[0])}–${pct(s.winrateCI[1])}`} />
            <Metric label="Profit-Faktor" value={fmt(s.profitFactor)} tone={s.profitFactor >= 1 ? "pos" : "neg"} />
            <Metric label="Ø Gewinn / Verlust" value={`${fmt(s.avgWin)} / ${fmt(s.avgLoss)}`} sub="in R" />
            <Metric label="Max Drawdown" value={`${fmt(s.maxDD)}R`} tone="neg" />
          </div>

          {/* Equity-Kurve */}
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
            <div className="mb-2 flex items-baseline justify-between">
              <span className="text-[11px] uppercase tracking-wider text-zinc-500">Equity-Kurve (kumuliert R)</span>
              <span className={`font-mono text-sm ${s.sumR >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{s.sumR >= 0 ? "+" : ""}{fmt(s.sumR)}R gesamt</span>
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={s.curve}>
                <XAxis dataKey="i" stroke="#52525b" fontSize={11} tickLine={false} />
                <YAxis stroke="#52525b" fontSize={11} tickLine={false} width={32} />
                <ReferenceLine y={0} stroke="#3f3f46" />
                <Tooltip
                  contentStyle={{ background: "#18181b", border: "1px solid rgba(255,255,255,.08)", borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: "#a1a1aa" }}
                  formatter={(v) => [`${v}R`, "Equity"]}
                />
                <Line type="monotone" dataKey="eq" stroke="#38bdf8" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* R-Verteilung */}
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
            <div className="mb-2 text-[11px] uppercase tracking-wider text-zinc-500">R-Verteilung</div>
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={s.bins}>
                <XAxis dataKey="key" stroke="#52525b" fontSize={10} tickLine={false} />
                <YAxis stroke="#52525b" fontSize={11} tickLine={false} width={28} allowDecimals={false} />
                <Tooltip cursor={{ fill: "rgba(255,255,255,.03)" }} contentStyle={{ background: "#18181b", border: "1px solid rgba(255,255,255,.08)", borderRadius: 8, fontSize: 12 }} />
                <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                  {s.bins.map((b, i) => <Cell key={i} fill={b.hi <= 0 ? "#fb7185" : "#34d399"} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Analyzer */}
          <Analyzer
            hasCriteria={hasCriteria}
            analysis={analysis}
            ran={ran}
            runAnalysis={runAnalysis}
            combos={combos}
            setCombos={(v) => { setCombos(v); resetRan(); }}
          />
        </>
      )}
    </div>
  );
}

/* ---------- Der Problemquellen-Analyzer ---------- */
function Analyzer({ hasCriteria, analysis, ran, runAnalysis, combos, setCombos }) {
  const rel = (n) =>
    n >= 30 ? { txt: "belastbar", c: "text-emerald-400" }
    : n >= 12 ? { txt: "vorsichtig", c: "text-amber-400" }
    : n >= 5 ? { txt: "schwach", c: "text-orange-400" }
    : { txt: "Rauschen", c: "text-rose-400" };

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-zinc-500">
          <Search size={13} /> Problemquellen-Analyse
        </span>
        <label className="ml-auto flex items-center gap-1.5 text-xs text-zinc-400">
          <input type="checkbox" checked={combos} onChange={(e) => setCombos(e.target.checked)} className="accent-sky-400" />
          2-fach-Kombinationen
        </label>
        <button onClick={runAnalysis} className="rounded-lg bg-sky-400 px-3.5 py-1.5 text-sm font-medium text-zinc-950 hover:bg-sky-300">
          Analysieren
        </button>
      </div>

      {!hasCriteria && (
        <p className="text-sm text-zinc-500">Keine analysierbaren Kriterien (numerisch/Dropdown) definiert.</p>
      )}

      {ran && analysis && (
        <>
          <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/[0.06] px-3 py-2 text-xs text-amber-200/80">
            <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-400" />
            <span>
              Sortiert nach <b>Expectancy × Stichproben-Dämpfung</b>, nicht nach nackter Winrate.
              {combos && <> Bei aktivierten Kombis testest du viele Segmente gleichzeitig – die scheinbar „beste" ist mit hoher Wahrscheinlichkeit Zufall. </>}
              Alles unter n≈30 ist Hypothese, kein Edge. Nicht live umsetzen, ohne out-of-sample zu prüfen.
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/[0.06] text-left text-[11px] uppercase tracking-wider text-zinc-500">
                  <th className="px-3 py-2 font-medium">Segment</th>
                  <th className="px-3 py-2 text-right font-medium">n</th>
                  <th className="px-3 py-2 text-right font-medium">Expectancy</th>
                  <th className="px-3 py-2 text-right font-medium">Winrate (95% CI)</th>
                  <th className="px-3 py-2 text-right font-medium">Aussagekraft</th>
                </tr>
              </thead>
              <tbody>
                {analysis.map((r, i) => {
                  const q = rel(r.n);
                  return (
                    <tr key={i} className={`border-b border-white/[0.03] last:border-0 ${r.n < 5 ? "opacity-50" : ""}`}>
                      <td className="px-3 py-2 text-zinc-200">
                        {r.depth === 2 && <span className="mr-1 rounded bg-white/[0.06] px-1 py-0.5 text-[10px] text-zinc-400">Kombi</span>}
                        {r.label}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-zinc-400">{r.n}</td>
                      <td className={`px-3 py-2 text-right font-mono ${r.expectancy >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                        {r.expectancy >= 0 ? "+" : ""}{fmt(r.expectancy)}R
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-zinc-400">
                        {pct(r.winrate)} <span className="text-zinc-600">({pct(r.ci[0])}–{pct(r.ci[1])})</span>
                      </td>
                      <td className={`px-3 py-2 text-right ${q.c}`}>{q.txt}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-zinc-500">
            Lesart: Ein Segment ganz oben mit n=4 und „+3,0R" ist keine Goldader – das breite Konfidenzintervall
            verrät, dass du es nicht weißt. Interessant wird es erst, wo hohe Expectancy <i>und</i> „belastbar" zusammenfallen.
          </p>
        </>
      )}
    </div>
  );
}
