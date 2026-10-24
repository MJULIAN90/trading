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

  /** Etiquetas puestas a esta operacion. Solo vienen en el listado paginado. */
  tags?: string[];
  /** La nota, para el globo del listado. Solo viene en el listado paginado. */
  note?: string;
}

export interface CostSettings {
  commissionPerContract: number;
  /** Perdida maxima de una jornada, en dolares y en positivo. 0 = apagado. */
  dailyLossLimit: number;
}

export type TodayState = 'sin-limite' | 'ok' | 'cerca' | 'pasado';

export interface TodayReport {
  date: string;
  operations: number;
  contracts: number;
  grossPnl: number;
  commission: number;
  netPnl: number;
  limit: number;
  remaining: number | null;
  used: number | null;
  state: TodayState;
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
  forecast: number | null;
  previous: number | null;
  actual: number | null;
  unit: string | null;
  precision_digits: number | null;
  preliminary: number | null;
  reference_period: string | null;
  previous_revised_from: number | null;
  revision: string | null;
  event_key: string | null;
}

export interface MarketHoliday {
  id: string;
  exchange: string;
  name: string;
  day: string;
  from_ts: number;
  to_ts: number;
  full_day: number;
  source: string | null;
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
  longs: number;
  shorts: number;
  longWins: number;
  shortWins: number;
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
  byWeekday: Group[];
  byHour: Group[];
  byDirection: Group[];
  equity: Array<{ ts: number; pnl: number; equity: number }>;
  behaviour: { maxGapMinutes: number; revenge: Summary; rest: Summary };
  flagImpact: FlagImpact[];
  patterns: PatternReport;
  accounts: Array<{ id: string; operations: number; from: number; to: number }>;
  chartPrefs: ChartPrefs;
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

export interface EventPage {
  items: EconomicEvent[];
  total: number;
  page: number;
  pages: number;
  grandTotal: number;
}

export interface EventQuery {
  q?: string;
  impact?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
  /** Incluir lo que ya ocurrio. Por defecto el servidor lo oculta. */
  includePast?: boolean;
}

export interface EmaSetting {
  period: number;
  color: string;
  on: boolean;
}

export interface ChartPrefs {
  timeframe: number;
  candles: number;
  beforeShare: number;
  marginTop: number;
  deltaShare: number;
  rightOffset: number;
  entryShare: number;
  noteTags: string[];
  /**
   * Si cada etiqueta describe una conducta buena o mala, SEGUN EL. Lo que no
   * esta aqui es neutro. Es una hipotesis suya, no una medida: lo que de
   * verdad sumo o resto cada etiqueta sale de /api/tags.
   */
  tagPolarity: Record<string, 'buena' | 'mala'>;
  /**
   * De que eje habla cada etiqueta. Ausente = conducta.
   * estrategia = que clase de operacion era · contexto = que habia en el
   * mercado · conducta = que hiciste tu. Solo conducta lleva verde/rojo.
   */
  tagKind: Record<string, 'estrategia' | 'contexto'>;
  emas: EmaSetting[];
  showSessions: boolean;
}

export const TIMEFRAMES = [1, 5, 15, 60, 240] as const;

export function timeframeLabel(minutes: number): string {
  return minutes >= 60 ? `${minutes / 60}h` : `${minutes}m`;
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

export interface PatternRead {
  code: string;
  label: string;
  help: string;
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  /** Minutos que la componen: 15 es completa, menos significa huecos de captura. */
  minutes: number;
  bodyShare: number;
  bullish: boolean;
}

export interface PatternRow {
  code: string;
  label: string;
  help: string;
  operations: number;
  wins: number;
  pnl: number;
  medianMfe: number | null;
  medianGivenBack: number | null;
  /** Mediana del resultado en ticks. Comparable con medianMfe: mismo grupo. */
  medianResult: number | null;
}

export interface PatternReport {
  rows: PatternRow[];
  skipped: number;
  incomplete: number;
}

export interface SessionStat {
  session: string;
  samples: number;
  days: number;
  barRange: number;
  favP50: number;
  favP75: number;
  advP50: number;
  advP75: number;
  advP90: number;
  suggestedStop: number;
  suggestedTarget: number;
  ratio: number;
  trades: number;
  wins: number;
  losses: number;
  timeouts: number;
  ambiguous: number;
  hitRate: number;
  timeoutRate: number;
  breakEven: number;
  expectancy: number;
  longExpectancy: number;
  shortExpectancy: number;
  expectancyError: number;
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
  pattern: PatternRead | null;
  timeframe: number;
  sessionStat: SessionStat | null;
  minutesIntoSession: number | null;
  coverage: {
    before: number;
    after: number;
    found: number;
    expected: number;
    /** Velas de 1m que hay DONDE esta la operacion. 0 = el grafico no es suyo. */
    aroundEntry: number;
    entryWindowMin: number;
  };
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
  /** Etiquetas presentes, para el filtro rapido. Sin aplicar el filtro de etiquetas. */
  tags?: Array<{ tag: string; count: number }>;
}

export interface Filters {
  from?: string;
  to?: string;
  session?: string;
  excludeTests?: boolean;
  onlyFlagged?: boolean;
  /** Sobre que cifra se calculan las metricas. Neto por defecto. */
  basis?: 'net' | 'gross';
  direction?: 'LONG' | 'SHORT';
  /** Cuenta del broker. Vacio = todas. */
  account?: string;
  /** Solo ganadoras o solo perdedoras, sobre el neto. */
  result?: 'win' | 'loss';
  /** Varias sesiones a la vez. Vacio o ausente = todas. */
  sessions?: string[];
  /** Varias etiquetas a la vez. Cruza por CUALQUIERA de ellas, no por todas. */
  tags?: string[];
  /** Dias de mercado concretos (YYYY-MM-DD). Vacio o ausente = todos. */
  days?: string[];
}

export function qs(filters: Filters, extra: Record<string, string | number> = {}): string {
  const p = new URLSearchParams();
  if (filters.from) p.set('from', filters.from);
  if (filters.to) p.set('to', filters.to);
  if (filters.session) p.set('session', filters.session);
  if (filters.excludeTests) p.set('excludeTests', 'true');
  if (filters.onlyFlagged) p.set('onlyFlagged', 'true');
  if (filters.basis) p.set('basis', filters.basis);
  if (filters.direction) p.set('direction', filters.direction);
  if (filters.account) p.set('account', filters.account);
  if (filters.result) p.set('result', filters.result);
  if (filters.sessions?.length) p.set('sessions', filters.sessions.join(','));
  if (filters.days?.length) p.set('days', filters.days.join(','));
  if (filters.tags?.length) p.set('tags', filters.tags.join(','));
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

  replay: (id: number, timeframe?: number, candles?: number) => {
    const p = new URLSearchParams();
    if (timeframe) p.set('timeframe', String(timeframe));
    if (candles) p.set('candles', String(candles));
    return get<Replay>(`/api/operations/${id}/replay?${p.toString()}`);
  },

  /** Solo la lectura en prosa, sin arrastrar las velas del grafico. */
  reading: (id: number) => get<Narrative>(`/api/operations/${id}/reading`),

  chartPrefs: () => get<ChartPrefs>('/api/prefs/chart'),

  calendarEvents: (query: EventQuery) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== '') p.set(k, String(v));
    }
    return get<EventPage>(`/api/calendar/events?${p.toString()}`);
  },

  holidays: () => get<MarketHoliday[]>('/api/calendar/holidays'),

  clearCalendar: async () => {
    const res = await fetch('/api/calendar/events', { method: 'DELETE' });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return (await res.json()) as { deleted: number };
  },

  saveChartPrefs: async (patch: Partial<ChartPrefs>) => {
    const res = await fetch('/api/prefs/chart', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return (await res.json()) as ChartPrefs;
  },

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

  /**
   * Renombra una etiqueta. Toca las operaciones Y la lista de sugerencias.
   *
   * No pasa por el borrador de ajustes como el resto de los campos: no es un
   * valor que se este escribiendo, es una accion sobre datos ya guardados. Por
   * eso se aplica al confirmarla, y devuelve las prefs ya validadas para que
   * la pantalla no tenga que adivinar como quedo la lista.
   */
  renameTag: async (from: string, to: string) => {
    const res = await fetch(`/api/tags/${encodeURIComponent(from)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ to }),
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return (await res.json()) as {
      from: string;
      to: string;
      operations: number;
      merged: boolean;
      prefs: ChartPrefs;
    };
  },

  importCalendar: async () => {
    const res = await fetch('/api/calendar/import', { method: 'POST' });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return (await res.json()) as {
      files: number; read: number; added: number; skipped: number; floating: number; dir: string;
    };
  },

  saveSettings: async (next: Partial<CostSettings>) => {
    const res = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(next),
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return (await res.json()) as CostSettings;
  },

  today: async () => {
    const res = await fetch('/api/today');
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return (await res.json()) as TodayReport;
  },
};
