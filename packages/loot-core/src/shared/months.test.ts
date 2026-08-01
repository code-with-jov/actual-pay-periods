import * as monthUtils from './months';
import {
  resetPayPeriodConfigForTesting,
  setPayPeriodConfig,
} from './pay-period-config';

test('range returns a full range', () => {
  expect(monthUtils.range('2016-10', '2018-01')).toMatchSnapshot();
});

test('isValidYearMonthDay validates the day against the month and year', () => {
  expect(monthUtils.isValidYearMonthDay('2024-02-29')).toBe(true);
  expect(monthUtils.isValidYearMonthDay('2023-02-29')).toBe(false);
  expect(monthUtils.isValidYearMonthDay('2024-04-31')).toBe(false);
  expect(monthUtils.isValidYearMonthDay('2024-12-31')).toBe(true);
  expect(monthUtils.isValidYearMonthDay('2024-00-10')).toBe(false);
  expect(monthUtils.isValidYearMonthDay('2024-13-10')).toBe(false);
  expect(monthUtils.isValidYearMonthDay('2024-02-00')).toBe(false);
  expect(monthUtils.isValidYearMonthDay('2024-02')).toBe(false);
});

describe('pay period awareness', () => {
  beforeEach(() => {
    setPayPeriodConfig({ payFrequency: 'biweekly', startDate: '2024-01-05' });
  });

  afterEach(() => {
    resetPayPeriodConfigForTesting();
  });

  it('calendar behavior is untouched while pay periods are active', () => {
    expect(monthUtils.nextMonth('2024-01')).toBe('2024-02');
    expect(monthUtils.prevMonth('2024-01')).toBe('2023-12');
    expect(monthUtils.addMonths('2024-01', 13)).toBe('2025-02');
    expect(monthUtils.bounds('2024-02')).toEqual({
      start: 20240201,
      end: 20240229,
    });
    expect(monthUtils.monthFromDate('2024-01-10')).toBe('2024-01');
    expect(monthUtils.rangeInclusive('2024-01', '2024-03')).toEqual([
      '2024-01',
      '2024-02',
      '2024-03',
    ]);
  });

  it('resolves pay period IDs through the standard month functions', () => {
    expect(monthUtils.nextMonth('2024-13')).toBe('2024-14');
    expect(monthUtils.prevMonth('2024-14')).toBe('2024-13');
    expect(monthUtils.addMonths('2024-13', 2)).toBe('2024-15');
    expect(monthUtils.subMonths('2024-15', 2)).toBe('2024-13');
    // 2024-13 = Jan 5 - Jan 18 under this config.
    expect(monthUtils.bounds('2024-13')).toEqual({
      start: 20240105,
      end: 20240118,
    });
    expect(monthUtils.rangeInclusive('2024-13', '2024-15')).toEqual([
      '2024-13',
      '2024-14',
      '2024-15',
    ]);
    expect(monthUtils.range('2024-13', '2024-15')).toEqual([
      '2024-13',
      '2024-14',
    ]);
    expect(monthUtils.sheetForMonth('2024-13')).toBe('budget202413');
    expect(monthUtils.isBefore('2024-13', '2024-14')).toBe(true);
    expect(monthUtils.isAfter('2024-14', '2024-13')).toBe(true);
    expect(monthUtils.getYearStart('2024-20')).toBe('2024-13');
    expect(monthUtils.nameForMonth('2024-13')).toBe('Jan 5 - Jan 18 (PP1)');
  });

  it('_parse resolves a pay period to its start date', () => {
    const parsed = monthUtils._parse('2024-13');
    expect(parsed.getFullYear()).toBe(2024);
    expect(parsed.getMonth()).toBe(0);
    expect(parsed.getDate()).toBe(5);
  });

  it('budgetMonthFromDate routes dates to their containing period', () => {
    expect(monthUtils.budgetMonthFromDate('2024-01-10')).toBe('2024-13');
    expect(monthUtils.budgetMonthFromDate('2024-01-19')).toBe('2024-14');
  });

  it('throws when mixing calendar months and pay periods in a range', () => {
    expect(() => monthUtils.rangeInclusive('2024-11', '2024-15')).toThrow(
      /mixing/,
    );
  });

  it('resolveStartMonth keeps stored values only when they match the mode', () => {
    expect(monthUtils.resolveStartMonth('2024-14', '2024-13')).toBe('2024-14');
    expect(monthUtils.resolveStartMonth('2024-01', '2024-13')).toBe('2024-13');
    expect(monthUtils.resolveStartMonth(undefined, '2024-13')).toBe('2024-13');
  });

  it('budgetColumnDayRange returns the period days, not the calendar month days', () => {
    // '2024-13' is Jan 5 - Jan 18 under this config. firstDayOfMonth would
    // resolve the period to Jan 5 and then snap back to Jan 1.
    expect(monthUtils.budgetColumnDayRange('2024-13')).toEqual({
      start: '2024-01-05',
      end: '2024-01-18',
    });
    expect(monthUtils.budgetColumnDayRange('2024-02')).toEqual({
      start: '2024-02-01',
      end: '2024-02-29',
    });
  });

  it('budgetColumnDistance counts columns, and reports past targets as negative', () => {
    expect(monthUtils.budgetColumnDistance('2024-13', '2024-13')).toBe(0);
    expect(monthUtils.budgetColumnDistance('2024-13', '2024-16')).toBe(3);
    // A true signed distance, not a -1 sentinel: callers divide by these
    // spans, so the magnitude matters as much as the sign.
    expect(monthUtils.budgetColumnDistance('2024-16', '2024-13')).toBe(-3);
    // Across a year boundary: the last period of 2024 to the first of 2025.
    const lastOf2024 = monthUtils.getYearEnd('2024-13');
    expect(monthUtils.budgetColumnDistance(lastOf2024, '2025-13')).toBe(1);
  });

  it('budgetColumnForCalendarMonth maps a calendar target onto a column', () => {
    // Hard-coded, not derived through budgetMonthFromDate — the helper is
    // implemented in terms of it, so a derived expectation would cancel out
    // any shared error. Biweekly from Jan 5: '2024-16' is Feb 16 - Feb 29
    // and '2024-14' is Jan 19 - Feb 1.
    expect(monthUtils.budgetColumnForCalendarMonth('2024-02', 'end')).toBe(
      '2024-16',
    );
    expect(monthUtils.budgetColumnForCalendarMonth('2024-02', 'start')).toBe(
      '2024-14',
    );
  });

  it('addMonthsToDay preserves the day-of-month, clamping short months', () => {
    expect(monthUtils.addMonthsToDay('2024-01-15', 1)).toBe('2024-02-15');
    expect(monthUtils.addMonthsToDay('2024-01-31', 1)).toBe('2024-02-29');
    expect(monthUtils.addMonthsToDay('2024-06-15', -3)).toBe('2024-03-15');
  });

  it('budgetColumnDistance fails loudly on a runaway pair', () => {
    expect(() => monthUtils.budgetColumnDistance('2024-13', '2500-13')).toThrow(
      /exceeds/,
    );
  });

  it('resolveStartMonth rejects a period that the active cadence never generates', () => {
    // A biweekly year has 26-27 periods, so '2024-70' cannot exist even
    // though it is shaped like a pay period ID.
    expect(monthUtils.resolveStartMonth('2024-70', '2024-13')).toBe('2024-13');

    // Switching a stored weekly period to a monthly cadence: monthly only
    // reaches '2024-24', so period 28 has to fall back.
    setPayPeriodConfig({ payFrequency: 'monthly', startDate: '2024-01-15' });
    expect(monthUtils.resolveStartMonth('2024-40', '2024-13')).toBe('2024-13');
    expect(monthUtils.resolveStartMonth('2024-24', '2024-13')).toBe('2024-24');
  });
});

describe('pay period IDs without an active config', () => {
  beforeEach(() => {
    resetPayPeriodConfigForTesting();
  });

  it('fails fast instead of silently misparsing', () => {
    expect(() => monthUtils._parse('2024-13')).toThrow(/no pay period/);
    expect(() => monthUtils.nextMonth('2024-13')).toThrow(/no pay period/);
    expect(() => monthUtils.bounds('2024-13')).toThrow(/no pay period/);
  });

  it('resolveStartMonth falls back to the calendar month', () => {
    expect(monthUtils.resolveStartMonth('2024-14', '2024-01')).toBe('2024-01');
    expect(monthUtils.resolveStartMonth('2024-01', '2024-02')).toBe('2024-01');
  });

  it('budgetMonthFromDate falls back to the calendar month', () => {
    expect(monthUtils.budgetMonthFromDate('2024-01-10')).toBe('2024-01');
  });

  it('budget column helpers are calendar identities', () => {
    expect(monthUtils.budgetColumnDayRange('2024-02')).toEqual({
      start: '2024-02-01',
      end: '2024-02-29',
    });
    expect(monthUtils.budgetColumnDistance('2024-01', '2024-04')).toBe(3);
    expect(monthUtils.budgetColumnForCalendarMonth('2024-02', 'end')).toBe(
      '2024-02',
    );
    expect(monthUtils.budgetColumnForCalendarMonth('2024-02', 'start')).toBe(
      '2024-02',
    );
  });

  it('getYearStart fails fast on a period ID', () => {
    expect(() => monthUtils.getYearStart('2024-20')).toThrow(/no pay period/);
  });
});
