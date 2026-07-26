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
});
