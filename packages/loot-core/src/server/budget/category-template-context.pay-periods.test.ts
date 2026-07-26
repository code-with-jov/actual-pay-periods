import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Currency } from '#shared/currencies';
import {
  resetPayPeriodConfigForTesting,
  setPayPeriodConfig,
} from '#shared/pay-period-config';
import { generatePayPeriods } from '#shared/pay-periods';
import type { PayPeriodConfig } from '#shared/pay-periods';
import type { CategoryEntity } from '#types/models';
import type { Template } from '#types/models/templates';

import { getSheetValue } from './actions';
import { CategoryTemplateContext } from './category-template-context';

// Mirrors the mock in the calendar suite (category-template-context.test.ts).
vi.mock('./actions', () => ({
  getCategoryAverage: vi.fn(),
  getSheetValue: vi.fn(),
  getSheetBoolean: vi.fn(),
  isTrackingBudget: vi.fn(),
}));

// Weekly periods anchored on 2024-01-01, so each period is a whole week and
// January 2024 spans '2024-13' (Jan 1-7) through '2024-17' (Jan 29 - Feb 4).
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

const currency: Currency = {
  code: '',
  symbol: '',
  name: '',
  decimalPlaces: 2,
  numberFormat: 'comma-dot',
  symbolFirst: false,
};

const category = { id: 'cat-1', name: 'Test Category' } as CategoryEntity;

/** Exposes the protected constructor, as the calendar suite does. */
class TestCategoryTemplateContext extends CategoryTemplateContext {
  public constructor(
    templates: Template[],
    categoryEntity: CategoryEntity,
    month: string,
    fromLastMonth: number,
    budgeted: number,
  ) {
    super(
      templates,
      categoryEntity,
      month,
      fromLastMonth,
      budgeted,
      'USD',
      false,
    );
  }
}

/**
 * The template runners are static and read only a few fields off the
 * context, so a literal stands in for a fully initialized instance (which
 * would need a live spreadsheet).
 */
function makeContext(
  month: string,
  extra: { fromLastMonth?: number; templates?: Template[] } = {},
): CategoryTemplateContext {
  return {
    month,
    currency,
    category,
    fromLastMonth: extra.fromLastMonth ?? 0,
    templates: extra.templates ?? [],
  } as unknown as CategoryTemplateContext;
}

describe('runPeriodic in pay period mode', () => {
  afterEach(() => {
    resetPayPeriodConfigForTesting();
  });

  const weeklyTemplate = {
    type: 'periodic' as const,
    amount: 25,
    period: { period: 'week' as const, amount: 1 },
    starting: '2024-01-03',
    directive: 'template' as const,
    priority: 1,
  };

  it('budgets one occurrence per weekly period, not five', () => {
    // Calendar January contains five Wednesdays from the 3rd, so the
    // calendar-month answer is 5 x $25. Each weekly period contains one.
    resetPayPeriodConfigForTesting();
    expect(
      CategoryTemplateContext.runPeriodic(
        weeklyTemplate,
        makeContext('2024-01'),
      ),
    ).toBe(12500);

    setPayPeriodConfig(weeklyConfig);
    expect(
      CategoryTemplateContext.runPeriodic(
        weeklyTemplate,
        makeContext('2024-13'),
      ),
    ).toBe(2500);
    expect(
      CategoryTemplateContext.runPeriodic(
        weeklyTemplate,
        makeContext('2024-14'),
      ),
    ).toBe(2500);
  });

  it('budgets nothing in a period the occurrence misses', () => {
    setPayPeriodConfig(weeklyConfig);
    const monthlyTemplate = {
      ...weeklyTemplate,
      amount: 100,
      period: { period: 'month' as const, amount: 1 },
      starting: '2024-01-15',
    };

    // Jan 15 falls in one period only; the periods before it get nothing.
    expect(
      CategoryTemplateContext.runPeriodic(
        monthlyTemplate,
        makeContext(periodContaining('2024-01-15')),
      ),
    ).toBe(10000);
    expect(
      CategoryTemplateContext.runPeriodic(
        monthlyTemplate,
        makeContext(periodContaining('2024-01-08')),
      ),
    ).toBe(0);
  });

  it('defaults the start to the period start, not the calendar month start', () => {
    setPayPeriodConfig(weeklyConfig);
    const noStartDate = {
      ...weeklyTemplate,
      amount: 10,
      period: { period: 'day' as const, amount: 1 },
      starting: '',
    };

    // A daily template with no start date runs from the first day of the
    // budget column: seven days in a weekly period, not 31 in January.
    expect(
      CategoryTemplateContext.runPeriodic(noStartDate, makeContext('2024-13')),
    ).toBe(7000);
  });
});

describe('weekly `up to` limit in pay period mode', () => {
  afterEach(() => {
    resetPayPeriodConfigForTesting();
  });

  const weeklyLimit: Template = {
    type: 'simple',
    limit: { amount: 100, hold: false, period: 'weekly', start: '2024-01-01' },
    directive: 'template',
    priority: 1,
  };

  it('counts the weekly occurrences inside the period, not the year', async () => {
    // The calendar answer for January is five Mondays x $100.
    resetPayPeriodConfigForTesting();
    const calendar = new TestCategoryTemplateContext(
      [weeklyLimit],
      category,
      '2024-01',
      0,
      0,
    );
    expect(await calendar.runTemplatesForPriority(1, 100000, 100000)).toBe(
      50000,
    );

    // A weekly pay period contains exactly one of them. Before the fix the
    // limit resolved to 0, which reads as "already met" and budgets nothing.
    setPayPeriodConfig(weeklyConfig);
    const period = new TestCategoryTemplateContext(
      [weeklyLimit],
      category,
      '2024-13',
      0,
      0,
    );
    expect(await period.runTemplatesForPriority(1, 100000, 100000)).toBe(10000);
  });

  it('scales the daily limit to the period length', async () => {
    setPayPeriodConfig(weeklyConfig);
    const dailyLimit: Template = {
      type: 'simple',
      limit: { amount: 10, hold: false, period: 'daily' },
      directive: 'template',
      priority: 1,
    };
    const period = new TestCategoryTemplateContext(
      [dailyLimit],
      category,
      '2024-13',
      0,
      0,
    );
    // Seven days in a weekly period, not 31 in January.
    expect(await period.runTemplatesForPriority(1, 100000, 100000)).toBe(7000);
  });
});

describe('runSpend in pay period mode', () => {
  beforeEach(() => {
    vi.mocked(getSheetValue).mockResolvedValue(0);
  });

  afterEach(() => {
    resetPayPeriodConfigForTesting();
    vi.clearAllMocks();
  });

  const spendTemplate = {
    type: 'spend' as const,
    amount: 1200,
    from: '2024-01',
    month: '2024-03',
    annual: false,
    directive: 'template' as const,
    priority: 1,
  };

  it('spreads the target over the remaining budget columns', async () => {
    setPayPeriodConfig(weeklyConfig);

    // '2024-13' is Jan 1-7. The goal is due by the end of March, which under
    // a weekly cadence is many more columns away than the two calendar
    // months a month-based count would report.
    const perColumn = await CategoryTemplateContext.runSpend(
      spendTemplate,
      makeContext('2024-13'),
    );

    const calendarMonthsRemaining = 2;
    const perCalendarMonth = Math.round(120000 / (calendarMonthsRemaining + 1));
    expect(perColumn).toBeLessThan(perCalendarMonth);
    expect(perColumn).toBeGreaterThan(0);

    // Contributing `perColumn` in every column between now and the deadline
    // reaches the target without overshooting by a whole cadence.
    const columnsRemaining = Math.round(120000 / perColumn) - 1;
    expect(columnsRemaining).toBeGreaterThan(calendarMonthsRemaining);
  });

  it('reads the budget columns already elapsed, not calendar sheets', async () => {
    setPayPeriodConfig(weeklyConfig);

    await CategoryTemplateContext.runSpend(
      spendTemplate,
      makeContext(periodContaining('2024-02-01')),
    );

    // Every sheet read has to name a pay period sheet. A calendar sheet name
    // ('budget202401') is one that pay period mode never creates, and a
    // missing sheet reads back as zero rather than raising — which is how
    // the contributions already made used to get discarded.
    const sheetNames = vi
      .mocked(getSheetValue)
      .mock.calls.map(([sheetName]) => sheetName);
    expect(sheetNames.length).toBeGreaterThan(0);
    for (const sheetName of sheetNames) {
      const monthPart = sheetName.replace('budget', '').slice(4);
      expect(Number(monthPart)).toBeGreaterThanOrEqual(13);
    }
  });

  it('is unchanged in calendar mode', async () => {
    resetPayPeriodConfigForTesting();

    const perMonth = await CategoryTemplateContext.runSpend(
      spendTemplate,
      makeContext('2024-01'),
    );

    // Jan, Feb, Mar: three months to reach $1200.
    expect(perMonth).toBe(40000);
  });
});

describe('runBy in pay period mode', () => {
  afterEach(() => {
    resetPayPeriodConfigForTesting();
  });

  const byTemplate = {
    type: 'by' as const,
    amount: 600,
    month: '2024-03',
    annual: false,
    directive: 'template' as const,
    priority: 1,
  };

  it('divides the need by budget columns, not calendar months', () => {
    resetPayPeriodConfigForTesting();
    const { toBudget: calendarToBudget } = CategoryTemplateContext.runBy(
      makeContext('2024-01', { templates: [byTemplate] }),
    );
    // Jan, Feb, Mar.
    expect(calendarToBudget).toBe(20000);

    setPayPeriodConfig(weeklyConfig);
    const { toBudget: periodToBudget } = CategoryTemplateContext.runBy(
      makeContext('2024-13', { templates: [byTemplate] }),
    );
    expect(periodToBudget).toBeLessThan(calendarToBudget);
    expect(periodToBudget).toBeGreaterThan(0);
  });

  it('measures an annual repeat in budget columns too', () => {
    setPayPeriodConfig(weeklyConfig);
    const annual = { ...byTemplate, annual: true, repeat: 1 };

    // A target already in the past rolls forward by the repeat rather than
    // reporting a negative span and funding nothing.
    const { toBudget } = CategoryTemplateContext.runBy(
      makeContext(periodContaining('2024-06-01'), { templates: [annual] }),
    );
    expect(toBudget).toBeGreaterThan(0);
  });
});
