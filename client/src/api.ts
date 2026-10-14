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

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface Filters {
  from?: string;
  to?: string;
  session?: string;
  includeTests?: boolean;
  onlyFlagged?: boolean;
}

function qs(filters: Filters, extra: Record<string, string | number> = {}): string {
  const p = new URLSearchParams();
  if (filters.from) p.set('from', filters.from);
  if (filters.to) p.set('to', filters.to);
  if (filters.session) p.set('session', filters.session);
  if (filters.includeTests) p.set('includeTests', 'true');
  if (filters.onlyFlagged) p.set('onlyFlagged', 'true');
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
};
