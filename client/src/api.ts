export type Severity = 'alert' | 'warn' | 'info' | 'good';
export type FlagKind = 'decision' | 'outcome';

export interface Flag {
  code: string;
  kind: FlagKind;
  severity: Severity;
  title: string;
  detail: string;
}

export interface Review {
  operationId: number;
  flags: Flag[];
  decisionAlerts: number;
}

export interface Operation {
  id: number;
  symbol: string;
  opened_at: number;
  closed_at: number;
  direction: 'LONG' | 'SHORT';
  entry_price: number;
  exit_price: number;
  max_quantity: number;
  fills_count: number;
  gross_pnl: number;
  duration_sec: number;
  session: string;
  market_hour: number;
  review: Review;

  /** Ticks por contrato. null si el contrato no esta en la tabla de instrumentos. */
  ticks: number | null;
  points: number | null;
  tickValue: number | null;
  commission: number;
  netPnl: number;
  /** El bruto original, aunque gross_pnl lleve ya la base elegida. */
  rawGrossPnl: number;
  /** Recorrido mientras estuvo abierta. Solo viene en el listado paginado. */
  excursion?: Excursion;
}

export interface CostSettings {
  commissionPerContract: number;
}

export interface CostSummary {
  operations: number;
  contracts: number;
  grossPnl: number;
  commission: number;
  netPnl: number;
  commissionShare: number | null;
  ticksWon: number;
  ticksLost: number;
  avgTicksPerTrade: number | null;
  breakevenTicks: number;
}

export interface ExcursionSummary {
  analyzed: number;
  skipped: number;
  wins: { count: number; avgMae: number | null; avgMfe: number | null };
  losses: { count: number; avgMae: number | null; avgMfe: number | null };
  givenBack: number | null;
}

export interface EconomicEvent {
  id: string;
  ts: number;
  title: string;
  impact: string | null;
  currency: string | null;
  source: string | null;
  detail: string | null;
}

export interface CalendarStatus {
  total: number;
  coverTo: number | null;
  upcoming: EconomicEvent[];
  activeNow: Array<{ event: EconomicEvent; minutesTo: number }>;
  blackout: { beforeMin: number; afterMin: number };
}

export interface NewsImpact {
  inside: { count: number; pnl: number; median: number | null };
  outside: { count: number; pnl: number; median: number | null };
}

export interface ScratchCase {
  id: number;
  openedAt: number;
  direction: string;
  quantity: number;
  ticks: number;
  session: string;
  afterFavourable: number;
  afterAdverse: number;
  resolved: 1 | -1 | 0;
}

export interface ScratchReport {
  config: { maxTicks: number; horizonMinutes: number; targetTicks: number };
  total: number;
  analyzed: number;
  wouldHaveWorked: number;
  wouldHaveFailed: number;
  unresolved: number;
  avgAfterFavourable: number | null;
  avgAfterAdverse: number | null;
  symmetricTicks: number | null;
  cases: ScratchCase[];
}

export interface Excursion {
  mae: number | null;
  mfe: number | null;
  capture: number | null;
  /** Ticks que llegaste a tener y devolviste: MFE menos el resultado. */
  givenBack: number | null;
  bars: number;
}

export interface Summary {
  operations: number;
  wins: number;
  losses: number;
  winRate: number;
  grossPnl: number;
  avgWin: number;
  avgLoss: number;
  payoff: number;
  breakevenPayoff: number;
  expectancy: number;
  best: number;
  worst: number;
  avgWinMinutes: number;
  avgLossMinutes: number;
  maxWinStreak: number;
  maxLossStreak: number;
}

export interface Group {
  key: string | number;
  summary: Summary;
}

export interface FlagImpact {
  code: string;
  title: string;
  severity: Severity;
  count: number;
  pnl: number;
}

export interface Dashboard {
  marketOffsetHours: number;
  basis: 'net' | 'gross';
  costSettings: CostSettings;
  costs: CostSummary;
  excursion: ExcursionSummary;
  scratch: ScratchReport;
  calendar: CalendarStatus;
  news: NewsImpact;
  summary: Summary;
  bySession: Group[];
  byDay: Group[];
  byHour: Group[];
  byDirection: Group[];
  equity: Array<{ ts: number; pnl: number; equity: number }>;
  behaviour: { maxGapMinutes: number; revenge: Summary; rest: Summary };
  flagImpact: FlagImpact[];
  count: number;
}

export interface Bar {
  ts: number;
  o: number;
  h: number;
  l: number;
  c: number;
  delta: number | null;
  buy: number | null;
  sell: number | null;
  avgSize: number | null;
  maxOneTrade: number | null;
  typicalAbsDelta: number | null;
  avgRange: number | null;
  avgTradeSize: number | null;
  bookSkew: number | null;
  pulled: number | null;
}

export interface Narrative {
  lines: string[];
  takeaway: string | null;
}

export interface TrendRead {
  label: 'ALCISTA' | 'BAJISTA' | 'RANGO';
  strength: 'clara' | 'debil' | null;
  /** Avance neto / rango recorrido, de -1 a 1. */
  ratio: number;
  /** Donde cerro dentro del rango: 0 en el minimo, 1 en el maximo. */
  position: number;
  high: number;
  low: number;
  candles: number;
  from: number;
  to: number;
}

export interface TrendSnapshot {
  weekly: TrendRead | null;
  daily: TrendRead | null;
  h4: TrendRead | null;
}

export interface Replay {
  /** Sin `review`: ese calculo solo lo hace el listado, no el replay. */
  operation: Omit<Operation, 'review'>;
  excursion: Excursion;
  narrative: Narrative;
  symbol: string;
  bars: Bar[];
  fills: Array<{ ts: number; price: number; quantity: number; side: number }>;
  sessions: Array<{ name: string; from: number; to: number; fullFrom: number; fullTo: number }>;
  trend: TrendSnapshot;
  coverage: { before: number; after: number; found: number; expected: number };
}

export interface OperationNote {
  operationId: number;
  note: string;
  tags: string[];
  updatedAt: number | null;
}

export interface TagImpact {
  tag: string;
  count: number;
  pnl: number;
  wins: number;
}

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  /** Totales del conjunto filtrado entero, no solo de la pagina visible. */
  totals?: CostSummary;
  /** Dias con operaciones, para el filtro rapido. Sin aplicar el filtro de dias. */
  days?: Array<{ date: string; count: number; pnl: number }>;
}

export interface Filters {
  from?: string;
  to?: string;
  session?: string;
  includeTests?: boolean;
  onlyFlagged?: boolean;
  /** Sobre que cifra se calculan las metricas. Neto por defecto. */
  basis?: 'net' | 'gross';
  direction?: 'LONG' | 'SHORT';
  /** Varias sesiones a la vez. Vacio o ausente = todas. */
  sessions?: string[];
  /** Dias de mercado concretos (YYYY-MM-DD). Vacio o ausente = todos. */
  days?: string[];
}

function qs(filters: Filters, extra: Record<string, string | number> = {}): string {
  const p = new URLSearchParams();
  if (filters.from) p.set('from', filters.from);
  if (filters.to) p.set('to', filters.to);
  if (filters.session) p.set('session', filters.session);
  if (filters.includeTests) p.set('includeTests', 'true');
  if (filters.onlyFlagged) p.set('onlyFlagged', 'true');
  if (filters.basis) p.set('basis', filters.basis);
  if (filters.direction) p.set('direction', filters.direction);
  if (filters.sessions?.length) p.set('sessions', filters.sessions.join(','));
  if (filters.days?.length) p.set('days', filters.days.join(','));
  for (const [k, v] of Object.entries(extra)) p.set(k, String(v));
  return p.toString();
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

export const api = {
  dashboard: (f: Filters) => get<Dashboard>(`/api/dashboard?${qs(f)}`),
  operations: (f: Filters, page: number, pageSize: number) =>
    get<Page<Operation>>(`/api/operations?${qs(f, { page, pageSize })}`),
  status: () =>
    get<{ autoIngest: boolean; intervalMs: number; lastIngest: { at: number; operationsNew: number; contextNew: number } | null }>(
      '/api/status',
    ),

  replay: (id: number, before = 45, after = 30) =>
    get<Replay>(`/api/operations/${id}/replay?before=${before}&after=${after}`),

  notes: (id: number) => get<OperationNote>(`/api/operations/${id}/notes`),

  saveNotes: async (id: number, note: string, tags: string[]) => {
    const res = await fetch(`/api/operations/${id}/notes`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ note, tags }),
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return (await res.json()) as OperationNote;
  },

  tags: () => get<{ impact: TagImpact[]; all: string[] }>('/api/tags'),

  importCalendar: async () => {
    const res = await fetch('/api/calendar/import', { method: 'POST' });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return (await res.json()) as {
      files: number; read: number; added: number; skipped: number; floating: number; dir: string;
    };
  },

  saveSettings: async (commissionPerContract: number) => {
    const res = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ commissionPerContract }),
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return (await res.json()) as CostSettings;
  },
};
