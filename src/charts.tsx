import {
  Area,
  AreaChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
} from 'recharts';
import type { Obligation, ScheduleEntry } from '@/types';
import { computeObligation } from '@/lib/finance-calc';
import { formatRUB } from '@/lib/format';

function cssVar(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function colors() {
  return {
    a1: cssVar('--accent-grad-1', '#8a5a33'),
    a2: cssVar('--accent-grad-2', '#b8814a'),
    track: cssVar('--surface-2', '#eee'),
    text: cssVar('--muted', '#888'),
    neg: cssVar('--neg', '#d9663f'),
    warn: cssVar('--warn', '#d79a2b'),
    surface: cssVar('--surface', '#fff'),
  };
}

const tooltipStyle = () => ({
  background: colors().surface,
  border: 'none',
  borderRadius: 12,
  boxShadow: '0 6px 20px rgba(0,0,0,0.18)',
  fontSize: 13,
});

/** Donut: principal vs overpayment. */
export function PrincipalVsOverpaymentChart({ obligation }: { obligation: Obligation }) {
  const c = computeObligation(obligation);
  const col = colors();
  const data = [
    { name: 'Основная сумма', value: obligation.principalAmount },
    {
      name: obligation.type === 'installment' ? 'Переплата' : 'Проценты',
      value: c.totalOverpayment,
    },
  ];
  if (c.totalOverpayment <= 0) data.pop();

  return (
    <ResponsiveContainer width="100%" height={180}>
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          innerRadius={52}
          outerRadius={78}
          paddingAngle={2}
          stroke="none"
        >
          <Cell fill={col.a1} />
          <Cell fill={col.warn} />
        </Pie>
        <Tooltip
          contentStyle={tooltipStyle()}
          formatter={(v: number, n: string) => [formatRUB(v), n]}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}

/** Stacked area: cumulative paid vs remaining over the schedule. */
export function CumulativePaidChart({ schedule }: { schedule: ScheduleEntry[] }) {
  const col = colors();
  const data = schedule.map((e) => ({
    m: e.index,
    Выплачено: Math.round(e.cumulativePaid),
    Осталось: Math.round(e.remaining),
  }));

  return (
    <ResponsiveContainer width="100%" height={180}>
      <AreaChart data={data} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="paidGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={col.a2} stopOpacity={0.9} />
            <stop offset="100%" stopColor={col.a1} stopOpacity={0.6} />
          </linearGradient>
        </defs>
        <XAxis
          dataKey="m"
          tick={{ fill: col.text, fontSize: 11 }}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip
          contentStyle={tooltipStyle()}
          labelFormatter={(m) => `Месяц ${m}`}
          formatter={(v: number, n: string) => [formatRUB(v), n]}
        />
        <Area
          type="monotone"
          dataKey="Выплачено"
          stackId="1"
          stroke={col.a1}
          fill="url(#paidGrad)"
        />
        <Area
          type="monotone"
          dataKey="Осталось"
          stackId="1"
          stroke={col.track}
          fill={col.track}
          fillOpacity={0.5}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Donut for a savings goal: saved vs remaining. */
export function SavingsDonut({ current, target }: { current: number; target: number }) {
  const col = colors();
  const remaining = Math.max(0, target - current);
  const data = [
    { name: 'Накоплено', value: Math.max(0, current) },
    { name: 'Осталось', value: remaining },
  ];
  return (
    <ResponsiveContainer width="100%" height={180}>
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          innerRadius={52}
          outerRadius={78}
          stroke="none"
        >
          <Cell fill={col.a1} />
          <Cell fill={col.track} />
        </Pie>
        <Tooltip
          contentStyle={tooltipStyle()}
          formatter={(v: number, n: string) => [formatRUB(v), n]}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}
