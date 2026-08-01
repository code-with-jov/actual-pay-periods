import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as db from '#server/db';
import { Rule } from '#server/rules';
import { getRuleForSchedule } from '#server/schedules/app';
import type { Currency } from '#shared/currencies';
import * as monthUtils from '#shared/months';
import {
  resetPayPeriodConfigForTesting,
  setPayPeriodConfig,
} from '#shared/pay-period-config';
import { generatePayPeriods } from '#shared/pay-periods';
import type { PayPeriodConfig } from '#shared/pay-periods';
import type { CategoryEntity } from '#types/models';

import { isTrackingBudget } from './actions';
import { runSchedule } from './schedule-template';

vi.mock('#server/db');
vi.mock('./actions');
vi.mock('#server/schedules/app', async () => {
  const actualModule = await vi.importActual('#server/schedules/app');
  return {
    ...actualModule,
    getRuleForSchedule: vi.fn(),
  };
});

// Weekly periods anchored on 2024-01-01, so January 2024 is covered by
// four whole periods: Jan 1-7 ('2024-13'), Jan 8-14, Jan 15-21 and
// Jan 22-28. A monthly bill lands in exactly one of them.
const weeklyConfig: PayPeriodConfig = {
  payFrequency: 'weekly',
  startDate: '2024-01-01',
};

const periods2024 = generatePayPeriods(2024, weeklyConfig);

function periodContaining(day: string): string {
  const period = periods2024.find(p => day >= p.startDate && day <= p.endDate);
  if (!period) {
    throw new Error(`No 2024 pay period contains ${day}`);
  }
  return period.monthId;
}

const defaultCurrency: Currency = {
  code: '',
  symbol: '',
  name: '',
  decimalPlaces: 2,
  numberFormat: 'comma-dot',
  symbolFirst: false,
};

const defaultCategory = { id: '1', name: 'Test Category' } as CategoryEntity;

const templateLines = [
  {
    type: 'schedule',
    name: 'Test Schedule',
    priority: 0,
    directive: 'template',
  } as const,
];

function mockSingleSchedule({
  start,
  amount,
  frequency,
  interval = 1,
}: {
  start: string;
  amount: number;
  frequency: 'monthly' | 'yearly' | 'weekly' | 'daily';
  interval?: number;
}) {
  vi.mocked(db.first).mockResolvedValue({ id: 1, completed: 0 });
  vi.mocked(getRuleForSchedule).mockResolvedValue(
    new Rule({
      id: 'r',
      stage: 'pre',
      conditionsOp: 'and',
      conditions: [
        {
          op: 'is',
          field: 'date',
          value: {
            start,
            interval,
            frequency,
            patterns: [],
            skipWeekend: false,
            weekendSolveMode: 'before',
            endMode: 'never',
            endOccurrences: 1,
            endDate: '2099-01-01',
          },
          type: 'date',
        },
        { op: 'is', field: 'amount', value: amount, type: 'number' },
      ],
      actions: [],
    }),
  );
  vi.mocked(isTrackingBudget).mockReturnValue(false);
}

function budgetColumn(month: string) {
  return runSchedule(
    templateLines,
    month,
    0,
    0,
    0,
    0,
    [],
    defaultCategory,
    defaultCurrency,
  );
}

describe('runSchedule with pay periods', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.getAccounts).mockResolvedValue([]);
    setPayPeriodConfig(weeklyConfig);
  });

  afterEach(() => {
    resetPayPeriodConfigForTesting();
  });

  it('funds a monthly schedule once across the pay periods of a calendar month', async () => {
    mockSingleSchedule({
      start: '2024-01-15',
      amount: -10000,
      frequency: 'monthly',
    });

    const januaryPeriods = ['2024-13', '2024-14', '2024-15', '2024-16'];
    const budgeted: number[] = [];
    for (const period of januaryPeriods) {
      const result = await budgetColumn(period);
      expect(result.errors).toHaveLength(0);
      budgeted.push(result.to_budget);
    }

    // The period containing the 15th funds the whole bill; the other
    // periods of the same calendar month fund nothing. Counting calendar
    // months instead of budget columns made every period look like the due
    // one and budget the full amount (~4x over-funding).
    expect(periodContaining('2024-01-15')).toBe('2024-15');
    expect(budgeted).toEqual([0, 0, 10000, 0]);
    expect(budgeted.reduce((total, value) => total + value, 0)).toBe(10000);
  });

  it('funds a weekly schedule once per weekly pay period', async () => {
    mockSingleSchedule({
      start: '2024-01-01',
      amount: -10000,
      frequency: 'weekly',
    });

    // One occurrence per period — not every occurrence of the calendar
    // month (or, as the mixed-unit comparison used to do, of the year).
    for (const period of ['2024-13', '2024-14', '2024-15']) {
      const result = await budgetColumn(period);
      expect(result.errors).toHaveLength(0);
      expect(result.to_budget).toBe(10000);
    }
  });

  it('spreads a sinking schedule across the budget columns until it is due', async () => {
    mockSingleSchedule({
      start: '2024-12-15',
      amount: -60000,
      frequency: 'yearly',
    });

    const dueColumn = periodContaining('2024-12-15');
    const columnsUntilDue =
      monthUtils.rangeInclusive('2024-13', dueColumn).length - 1;
    expect(columnsUntilDue).toBeGreaterThan(12);

    const result = await budgetColumn('2024-13');
    expect(result.errors).toHaveLength(0);
    expect(result.to_budget).toBe(Math.round(60000 / (columnsUntilDue + 1)));
  });

  it('spreads a full sinking fund over the columns of the year, not 12 months', async () => {
    // A yearly $1,200 schedule whose sinking fund is already full: the
    // engine keeps contributing the steady-state base amount. That base is
    // consumed once per budget column, so it has to be the target divided
    // by the ~52 weekly columns of the recurrence interval — dividing by 12
    // calendar months while adding it every column funded ~$5,200/yr.
    mockSingleSchedule({
      start: '2024-06-15',
      amount: -120000,
      frequency: 'yearly',
    });

    const result = await runSchedule(
      templateLines,
      '2024-13',
      120000, // balance already covers the full target
      0,
      0,
      0,
      [],
      defaultCategory,
      defaultCurrency,
    );
    expect(result.errors).toHaveLength(0);
    // Jan 1 + 12 months lands in '2024-65' (the Dec 30 - Jan 5 week): 52
    // columns → $1,200 / 52 ≈ $23.08 per column.
    expect(result.to_budget).toBe(2308);
  });

  it('reports a schedule whose next occurrence is in an earlier period as past', async () => {
    vi.mocked(db.first).mockResolvedValue({ id: 1, completed: 0 });
    vi.mocked(getRuleForSchedule).mockResolvedValue(
      new Rule({
        id: 'r',
        stage: 'pre',
        conditionsOp: 'and',
        conditions: [
          { op: 'is', field: 'date', value: '2024-01-02', type: 'date' },
          { op: 'is', field: 'amount', value: -10000, type: 'number' },
        ],
        actions: [],
      }),
    );
    vi.mocked(isTrackingBudget).mockReturnValue(false);

    // Jan 2 is in '2024-13', one period before the column being budgeted.
    const result = await budgetColumn('2024-14');
    expect(result.errors).toContainEqual(
      expect.stringMatching(/is in the Past/),
    );
    expect(result.to_budget).toBe(0);
  });
});

describe('runSchedule without pay periods', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.getAccounts).mockResolvedValue([]);
    resetPayPeriodConfigForTesting();
  });

  it('keeps funding a monthly schedule in full every calendar month', async () => {
    mockSingleSchedule({
      start: '2024-01-15',
      amount: -10000,
      frequency: 'monthly',
    });

    for (const month of ['2024-01', '2024-02', '2024-03']) {
      const result = await budgetColumn(month);
      expect(result.errors).toHaveLength(0);
      expect(result.to_budget).toBe(10000);
    }
  });

  it('keeps spreading a yearly schedule across the calendar months until due', async () => {
    mockSingleSchedule({
      start: '2024-12-15',
      amount: -60000,
      frequency: 'yearly',
    });

    // 11 months until December, so the contribution is target / 12.
    const result = await budgetColumn('2024-01-01');
    expect(result.errors).toHaveLength(0);
    expect(result.to_budget).toBe(5000);
  });

  it('keeps budgeting every daily occurrence of the calendar month', async () => {
    mockSingleSchedule({
      start: '2024-01-01',
      amount: -100,
      frequency: 'daily',
    });

    const result = await budgetColumn('2024-01-01');
    expect(result.to_budget).toBe(3100); // 31 days × $1
  });
});
