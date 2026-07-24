import {
  addPayPeriods,
  generatePayPeriods,
  getPayPeriodBounds,
  getPayPeriodDateFilter,
  getPayPeriodForDate,
  getPayPeriodLabel,
  isPayPeriod,
  nextPayPeriod,
  payPeriodRangeInclusive,
  prevPayPeriod,
  validatePayPeriodConfig,
  type PayPeriodConfig,
} from './pay-periods';

const biweekly: PayPeriodConfig = {
  payFrequency: 'biweekly',
  startDate: '2024-01-05',
};
const weekly: PayPeriodConfig = {
  payFrequency: 'weekly',
  startDate: '2024-01-05',
};
const monthly: PayPeriodConfig = {
  payFrequency: 'monthly',
  startDate: '2024-01-15',
};

function day(value: string): Date {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
}

describe('isPayPeriod', () => {
  it('identifies pay period IDs (MM 13-99)', () => {
    expect(isPayPeriod('2024-13')).toBe(true);
    expect(isPayPeriod('2024-38')).toBe(true);
    expect(isPayPeriod('2024-99')).toBe(true);
  });

  it('rejects calendar months, days, and malformed values', () => {
    expect(isPayPeriod('2024-01')).toBe(false);
    expect(isPayPeriod('2024-12')).toBe(false);
    expect(isPayPeriod('2024-13-01')).toBe(false);
    expect(isPayPeriod('2024')).toBe(false);
    expect(isPayPeriod('garbage')).toBe(false);
    expect(isPayPeriod('')).toBe(false);
  });
});

describe('validatePayPeriodConfig', () => {
  it('accepts valid configs', () => {
    expect(
      validatePayPeriodConfig({
        payFrequency: 'biweekly',
        startDate: '2024-01-05',
      }),
    ).toEqual({ payFrequency: 'biweekly', startDate: '2024-01-05' });
  });

  it('rejects unknown frequencies', () => {
    expect(
      validatePayPeriodConfig({
        payFrequency: 'fortnightly',
        startDate: '2024-01-05',
      }),
    ).toBeNull();
  });

  it('rejects missing or malformed start dates', () => {
    expect(
      validatePayPeriodConfig({ payFrequency: 'weekly', startDate: '' }),
    ).toBeNull();
    expect(
      validatePayPeriodConfig({ payFrequency: 'weekly' }),
    ).toBeNull();
    expect(
      validatePayPeriodConfig({
        payFrequency: 'weekly',
        startDate: '2024-1-5',
      }),
    ).toBeNull();
    expect(
      validatePayPeriodConfig({
        payFrequency: 'weekly',
        startDate: '2024-02-30',
      }),
    ).toBeNull();
    expect(
      validatePayPeriodConfig({
        payFrequency: 'weekly',
        startDate: '2023-02-29',
      }),
    ).toBeNull();
  });

  it('accepts leap-day start dates in leap years', () => {
    expect(
      validatePayPeriodConfig({
        payFrequency: 'monthly',
        startDate: '2024-02-29',
      }),
    ).not.toBeNull();
  });
});

describe('generatePayPeriods', () => {
  it('generates 26 or 27 biweekly periods numbered from -13', () => {
    const periods = generatePayPeriods(2024, biweekly);
    expect(periods.length).toBeGreaterThanOrEqual(26);
    expect(periods.length).toBeLessThanOrEqual(27);
    expect(periods[0].monthId).toBe('2024-13');
    expect(periods[periods.length - 1].monthId).toBe(
      `2024-${13 + periods.length - 1}`,
    );
  });

  it('starts the first period in January of the requested year', () => {
    for (const config of [biweekly, weekly, monthly]) {
      for (const year of [2023, 2024, 2025, 2026]) {
        const periods = generatePayPeriods(year, config);
        expect(periods[0].monthId).toBe(`${year}-13`);
        expect(periods[0].startDate.slice(0, 7)).toBe(`${year}-01`);
      }
    }
  });

  it('generates 52 or 53 weekly periods', () => {
    const periods = generatePayPeriods(2024, weekly);
    expect(periods.length).toBeGreaterThanOrEqual(52);
    expect(periods.length).toBeLessThanOrEqual(53);
  });

  it('generates exactly 12 monthly periods aligned to the start day', () => {
    const periods = generatePayPeriods(2024, monthly);
    expect(periods).toHaveLength(12);
    expect(periods[0].startDate).toBe('2024-01-15');
    expect(periods[0].endDate).toBe('2024-02-14');
    expect(periods[1].startDate).toBe('2024-02-15');
    expect(periods[11].endDate).toBe('2025-01-14');
  });

  it('clamps monthly start days to short months', () => {
    const endOfMonth: PayPeriodConfig = {
      payFrequency: 'monthly',
      startDate: '2024-01-31',
    };
    const periods = generatePayPeriods(2024, endOfMonth);
    expect(periods[0].startDate).toBe('2024-01-31');
    // 2024 is a leap year: February clamps to the 29th.
    expect(periods[1].startDate).toBe('2024-02-29');
    expect(periods[0].endDate).toBe('2024-02-28');
    expect(periods[2].startDate).toBe('2024-03-31');
  });

  it('tiles periods contiguously across year boundaries', () => {
    for (const config of [biweekly, weekly, monthly]) {
      const prev = generatePayPeriods(2024, config);
      const next = generatePayPeriods(2025, config);
      const lastPrev = prev[prev.length - 1];
      const gap =
        day(next[0].startDate).getTime() - day(lastPrev.endDate).getTime();
      expect(gap).toBe(24 * 60 * 60 * 1000);
    }
  });

  it('anchors numbering to the year even when the reference date is in another year', () => {
    const futureAnchor: PayPeriodConfig = {
      payFrequency: 'biweekly',
      startDate: '2024-09-26',
    };
    const periods = generatePayPeriods(2024, futureAnchor);
    expect(periods[0].monthId).toBe('2024-13');
    expect(periods[0].startDate.slice(0, 7)).toBe('2024-01');
    // The reference date itself must be a period start.
    expect(periods.some(p => p.startDate === '2024-09-26')).toBe(true);
  });

  it('returns the cached array for repeated calls', () => {
    const a = generatePayPeriods(2024, biweekly);
    const b = generatePayPeriods(2024, { ...biweekly });
    expect(b).toBe(a);
  });

  it('does not thrash the cache across adjacent years', () => {
    const a2024 = generatePayPeriods(2024, biweekly);
    generatePayPeriods(2025, biweekly);
    expect(generatePayPeriods(2024, biweekly)).toBe(a2024);
  });

  it('throws on invalid configs', () => {
    expect(() =>
      generatePayPeriods(2024, {
        payFrequency: 'biweekly',
        startDate: 'not-a-date',
      }),
    ).toThrow(/invalid pay period config/);
  });
});

describe('getPayPeriodForDate', () => {
  it('finds the period containing a date', () => {
    // 2024-13 runs Jan 5 - Jan 18 for the biweekly config.
    expect(getPayPeriodForDate(day('2024-01-10'), biweekly)).toBe('2024-13');
    expect(getPayPeriodForDate(day('2024-01-05'), biweekly)).toBe('2024-13');
    expect(getPayPeriodForDate(day('2024-01-18'), biweekly)).toBe('2024-13');
    expect(getPayPeriodForDate(day('2024-01-19'), biweekly)).toBe('2024-14');
  });

  it('routes early-January dates to the prior year’s last period', () => {
    const periods2024 = generatePayPeriods(2024, biweekly);
    const last2024 = periods2024[periods2024.length - 1];
    // The last 2024 period extends into January 2025.
    expect(last2024.endDate.slice(0, 4)).toBe('2025');
    expect(getPayPeriodForDate(day(last2024.endDate), biweekly)).toBe(
      last2024.monthId,
    );
    const dayAfter = day(last2024.endDate);
    dayAfter.setDate(dayAfter.getDate() + 1);
    expect(getPayPeriodForDate(dayAfter, biweekly)).toBe('2025-13');
  });

  it('covers every day of the year exactly once', () => {
    for (const config of [biweekly, monthly]) {
      let cursor = day('2024-01-01');
      const end = day('2024-12-31');
      let previous: string | null = null;
      while (cursor <= end) {
        const id = getPayPeriodForDate(cursor, config);
        expect(isPayPeriod(id)).toBe(true);
        if (previous && previous !== id) {
          // IDs only ever move forward.
          expect(id > previous || previous.slice(0, 4) < id.slice(0, 4)).toBe(
            true,
          );
        }
        previous = id;
        cursor.setDate(cursor.getDate() + 1);
      }
    }
  });
});

describe('period navigation', () => {
  it('nextPayPeriod advances and wraps years', () => {
    expect(nextPayPeriod('2024-13', biweekly)).toBe('2024-14');
    const count = generatePayPeriods(2024, biweekly).length;
    const last = `2024-${13 + count - 1}`;
    expect(nextPayPeriod(last, biweekly)).toBe('2025-13');
  });

  it('prevPayPeriod retreats and wraps years', () => {
    expect(prevPayPeriod('2024-14', biweekly)).toBe('2024-13');
    const priorCount = generatePayPeriods(2023, biweekly).length;
    expect(prevPayPeriod('2024-13', biweekly)).toBe(
      `2023-${13 + priorCount - 1}`,
    );
  });

  it('addPayPeriods handles positive, negative, and zero offsets', () => {
    expect(addPayPeriods('2024-13', 0, biweekly)).toBe('2024-13');
    expect(addPayPeriods('2024-13', 3, biweekly)).toBe('2024-16');
    expect(addPayPeriods('2024-16', -3, biweekly)).toBe('2024-13');
    const roundTrip = addPayPeriods(
      addPayPeriods('2024-13', 40, biweekly),
      -40,
      biweekly,
    );
    expect(roundTrip).toBe('2024-13');
  });

  it('payPeriodRangeInclusive spans year boundaries', () => {
    const count2024 = generatePayPeriods(2024, biweekly).length;
    const range = payPeriodRangeInclusive('2024-13', '2025-14', biweekly);
    expect(range[0]).toBe('2024-13');
    expect(range[range.length - 1]).toBe('2025-14');
    expect(range).toHaveLength(count2024 + 2);
    expect(payPeriodRangeInclusive('2024-14', '2024-13', biweekly)).toEqual(
      [],
    );
  });
});

describe('getPayPeriodBounds', () => {
  it('returns the period’s day range', () => {
    expect(getPayPeriodBounds('2024-13', biweekly)).toEqual({
      startDate: '2024-01-05',
      endDate: '2024-01-18',
    });
  });

  it('throws for IDs beyond the year’s period count', () => {
    expect(() => getPayPeriodBounds('2024-40', monthly)).toThrow(
      /does not exist/,
    );
  });
});

describe('getPayPeriodLabel', () => {
  it('formats summary labels with the date range and period number', () => {
    expect(getPayPeriodLabel('2024-13', biweekly, 'summary')).toBe(
      'Jan 5 - Jan 18 (PP1)',
    );
  });

  it('formats short labels as just the date range', () => {
    expect(getPayPeriodLabel('2024-13', biweekly, 'short')).toBe(
      'Jan 5 - Jan 18',
    );
  });

  it('formats picker labels as month letter plus position', () => {
    expect(getPayPeriodLabel('2024-13', biweekly, 'picker')).toBe('J1');
    expect(getPayPeriodLabel('2024-14', biweekly, 'picker')).toBe('J2');
    // 2024-15 starts Feb 2 under this config.
    expect(getPayPeriodLabel('2024-15', biweekly, 'picker')).toBe('F1');
  });
});

describe('getPayPeriodDateFilter', () => {
  it('returns a day-range filter for pay periods', () => {
    expect(getPayPeriodDateFilter('2024-13', biweekly)).toEqual({
      $gte: '2024-01-05',
      $lte: '2024-01-18',
    });
  });

  it('returns a $month transform for calendar months or no config', () => {
    expect(getPayPeriodDateFilter('2024-01', biweekly)).toEqual({
      $transform: '$month',
      $eq: '2024-01',
    });
    expect(getPayPeriodDateFilter('2024-13', null)).toEqual({
      $transform: '$month',
      $eq: '2024-13',
    });
  });
});
