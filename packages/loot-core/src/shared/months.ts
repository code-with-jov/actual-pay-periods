// @ts-strict-ignore
import * as d from 'date-fns';
import type { Locale } from 'date-fns';

import { memoizeOne } from '#shared/memoize';
import { getPayPeriodConfig } from '#shared/pay-period-config';
import { addPayPeriods, generatePayPeriods, getPayPeriodBounds, getPayPeriodForDate, getPayPeriodLabel, isPayPeriod, nextPayPeriod, payPeriodRangeInclusive, prevPayPeriod } from '#shared/pay-periods';
import type { PayPeriodConfig } from '#shared/pay-periods';
import * as Platform from '#shared/platform';
import type { SyncedPrefs } from '#types/prefs';

type DateLike = string | Date;
type Day = 0 | 1 | 2 | 3 | 4 | 5 | 6;

// Pay period IDs ('YYYY-MM' with MM 13-99) flow through the same code
// paths as calendar month IDs. Resolving one requires the active config
// from the registry (see pay-period-config.ts); using a pay period ID
// while no config is active is a lifecycle bug that must fail loudly —
// silently treating '2026-13' as a date would produce January 2027.
function requirePayPeriodConfig(id: string): PayPeriodConfig {
  const config = getPayPeriodConfig();
  if (!config) {
    throw new Error(
      `Pay period '${id}' was used while no pay period configuration is active. ` +
        'Pay period IDs should only exist while pay periods are enabled for the ' +
        'open budget (see setPayPeriodConfig in shared/pay-period-config.ts).',
    );
  }
  return config;
}

function isPayPeriodValue(value: DateLike): value is string {
  return typeof value === 'string' && isPayPeriod(value);
}

export function _parse(value: DateLike): Date {
  if (typeof value === 'string') {
    // Dates are hard. We just want to deal with months in the format
    // 2020-01 and days in the format 2020-01-01, but life is never
    // simple. We want to rely on native dates for date logic because
    // days are complicated (leap years, etc). But relying on native
    // dates mean we're exposed to craziness.
    //
    // The biggest problem is that JS dates work with local time by
    // default. We could try to only work with UTC, but there's not an
    // easy way to make `format` avoid local time, and not sure if we
    // want that anyway (`currentMonth` should surely print the local
    // time). We need to embrace local time, and as long as inputs to
    // date logic and outputs from format are local time, it should
    // work.
    //
    // To make sure we're in local time, always give Date integer
    // values. If you pass in a string to parse, different string
    // formats produce different results.
    //
    // A big problem is daylight savings, however. Usually, when
    // giving the time to the Date constructor, you get back a date
    // specifically for that time in your local timezone. However, if
    // daylight savings occurs on that exact time, you will get back
    // something different:
    //
    // This is fine:
    // > new Date(2017, 2, 12, 1).toString()
    // > 'Sun Mar 12 2017 01:00:00 GMT-0500 (Eastern Standard Time)'
    //
    // But wait, we got back a different time (3AM instead of 2AM):
    // > new Date(2017, 2, 12, 2).toString()
    // > 'Sun Mar 12 2017 03:00:00 GMT-0400 (Eastern Daylight Time)'
    //
    // The time is "correctly" adjusted via DST, but we _really_
    // wanted 2AM. The problem is that time simply doesn't exist.
    //
    // Why is this a problem? Well, consider a case where the DST
    // shift happens *at midnight* and it goes back an hour. You think
    // you have a date object for the next day, but when formatted it
    // actually shows the previous day. A more likely scenario: buggy
    // timezone data makes JS dates do this shift when it shouldn't,
    // so using midnight at the time for date logic gives back the
    // last day. See the time range of Sep 30 15:00 - Oct 1 1:00 for
    // the AEST timezone when nodejs-mobile incorrectly gives you back
    // a time an hour *before* you specified. Since this happens on
    // Oct 1, doing `addMonths(September, 1)` still gives you back
    // September. Issue here:
    // https://github.com/JaneaSystems/nodejs-mobile/issues/251
    //
    // The fix is simple once you understand this. Always use the 12th
    // hour of the day. That's it. There is no DST that shifts more
    // than 12 hours (god let's hope not) so no matter how far DST has
    // shifted backwards or forwards, doing date logic will stay
    // within the day we want.

    if (isPayPeriod(value)) {
      const config = requirePayPeriodConfig(value);
      const { startDate } = getPayPeriodBounds(value, config);
      const [py, pm, pd] = startDate.split('-').map(Number);
      return new Date(py, pm - 1, pd, 12);
    }

    const [year, month, day] = value.split('-');
    if (day != null) {
      return new Date(parseInt(year), parseInt(month) - 1, parseInt(day), 12);
    } else if (month != null) {
      return new Date(parseInt(year), parseInt(month) - 1, 1, 12);
    } else {
      return new Date(parseInt(year), 0, 1, 12);
    }
  }
  if (typeof value === 'number') {
    return new Date(value);
  }
  return value;
}

export const parseDate = _parse;

export function yearFromDate(date: DateLike): string {
  return d.format(_parse(date), 'yyyy');
}

export function monthFromDate(date: DateLike): string {
  return d.format(_parse(date), 'yyyy-MM');
}

/**
 * The budget column owning the given date: its pay period when pay
 * periods are active (year-boundary safe — a January date may belong to
 * the prior year's last period), otherwise its calendar month. Use this
 * for budget routing; use `monthFromDate` for calendar semantics
 * (reports, imports), which stay calendar-based by design.
 */
export function budgetMonthFromDate(date: DateLike): string {
  const config = getPayPeriodConfig();
  if (config) {
    return getPayPeriodForDate(_parse(date), config);
  }
  return monthFromDate(date);
}

export function isValidYearMonth(value: string): boolean {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return false;
  const month = Number(match[2]);
  return month >= 1 && month <= 12;
}

// Whether a value is day-shaped (`yyyy-MM-dd`) rather than month-shaped
// (`yyyy-MM`).
export function isValidYearMonthDay(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return false;
  return day >= 1 && day <= d.getDaysInMonth(new Date(year, month - 1));
}

export function weekFromDate(
  date: DateLike,
  firstDayOfWeekIdx: SyncedPrefs['firstDayOfWeekIdx'],
): string {
  const converted = parseInt(firstDayOfWeekIdx || '0') as Day;
  return d.format(
    _parse(d.startOfWeek(_parse(date), { weekStartsOn: converted })),
    'yyyy-MM-dd',
  );
}

export function firstDayOfMonth(date: DateLike): string {
  return dayFromDate(d.startOfMonth(_parse(date)));
}

export function lastDayOfMonth(date: DateLike): string {
  return dayFromDate(d.endOfMonth(_parse(date)));
}

export function dayFromDate(date: DateLike): string {
  return d.format(_parse(date), 'yyyy-MM-dd');
}

export function currentMonth(): string {
  if (global.IS_TESTING || Platform.isPlaywright) {
    return global.currentMonth || '2017-01';
  } else {
    return d.format(new Date(), 'yyyy-MM');
  }
}

/**
 * The budget column for "now": the current pay period when pay periods
 * are active, otherwise the current calendar month. The budget engine and
 * budget UI navigation should use this instead of `currentMonth`.
 */
export function currentBudgetMonth(): string {
  const config = getPayPeriodConfig();
  if (config) {
    return getPayPeriodForDate(currentDate(), config);
  }
  return currentMonth();
}

export function currentWeek(
  firstDayOfWeekIdx?: SyncedPrefs['firstDayOfWeekIdx'],
): string {
  if (global.IS_TESTING || Platform.isPlaywright) {
    return global.currentWeek || '2017-01-01';
  } else {
    const converted = parseInt(firstDayOfWeekIdx || '0') as Day;
    return d.format(
      _parse(d.startOfWeek(new Date(), { weekStartsOn: converted })),
      'yyyy-MM-dd',
    );
  }
}

export function currentYear(): string {
  if (global.IS_TESTING || Platform.isPlaywright) {
    return global.currentMonth || '2017';
  } else {
    return d.format(new Date(), 'yyyy');
  }
}

export function currentDate(): Date {
  if (global.IS_TESTING || Platform.isPlaywright) {
    return d.parse(currentDay(), 'yyyy-MM-dd', new Date());
  }

  return new Date();
}

export function currentDay(): string {
  if (global.IS_TESTING || Platform.isPlaywright) {
    return '2017-01-01';
  } else {
    return d.format(new Date(), 'yyyy-MM-dd');
  }
}

export function nextMonth(month: DateLike): string {
  if (isPayPeriodValue(month)) {
    return nextPayPeriod(month, requirePayPeriodConfig(month));
  }
  return d.format(d.addMonths(_parse(month), 1), 'yyyy-MM');
}

export function prevYear(month: DateLike, format = 'yyyy-MM'): string {
  return d.format(d.subMonths(_parse(month), 12), format);
}

export function prevMonth(month: DateLike): string {
  if (isPayPeriodValue(month)) {
    return prevPayPeriod(month, requirePayPeriodConfig(month));
  }
  return d.format(d.subMonths(_parse(month), 1), 'yyyy-MM');
}

export function addYears(year: DateLike, n: number): string {
  return d.format(d.addYears(_parse(year), n), 'yyyy');
}

export function addMonths(month: DateLike, n: number): string {
  if (isPayPeriodValue(month)) {
    return addPayPeriods(month, n, requirePayPeriodConfig(month));
  }
  return d.format(d.addMonths(_parse(month), n), 'yyyy-MM');
}

export function addWeeks(date: DateLike, n: number): string {
  return d.format(d.addWeeks(_parse(date), n), 'yyyy-MM-dd');
}

export function differenceInCalendarMonths(
  month1: DateLike,
  month2: DateLike,
): number {
  return d.differenceInCalendarMonths(_parse(month1), _parse(month2));
}

export function differenceInCalendarDays(
  month1: DateLike,
  month2: DateLike,
): number {
  return d.differenceInCalendarDays(_parse(month1), _parse(month2));
}

export function subMonths(month: string | Date, n: number) {
  if (isPayPeriodValue(month)) {
    return addPayPeriods(month, -n, requirePayPeriodConfig(month));
  }
  return d.format(d.subMonths(_parse(month), n), 'yyyy-MM');
}

export function subWeeks(date: DateLike, n: number): string {
  return d.format(d.subWeeks(_parse(date), n), 'yyyy-MM-dd');
}

export function subYears(year: string | Date, n: number) {
  return d.format(d.subYears(_parse(year), n), 'yyyy');
}

export function addDays(day: DateLike, n: number): string {
  return d.format(d.addDays(_parse(day), n), 'yyyy-MM-dd');
}

export function subDays(day: DateLike, n: number): string {
  return d.format(d.subDays(_parse(day), n), 'yyyy-MM-dd');
}

export function isBefore(month1: DateLike, month2: DateLike): boolean {
  return d.isBefore(_parse(month1), _parse(month2));
}

export function isAfter(month1: DateLike, month2: DateLike): boolean {
  return d.isAfter(_parse(month1), _parse(month2));
}

export function isCurrentMonth(month: DateLike): boolean {
  const current = isPayPeriodValue(month)
    ? currentBudgetMonth()
    : currentMonth();
  return month === current;
}

/**
 * Sanitizes a persisted budget start month (the `budget.startMonth` local
 * pref) against the active mode: a stored pay period ID is only valid
 * while pay periods are active, and vice versa. Returns `fallback`
 * (typically `currentBudgetMonth()`) when the stored value belongs to the
 * other mode — e.g. right after toggling pay periods on or off.
 */
export function resolveStartMonth(
  stored: string | undefined,
  fallback: string,
): string {
  if (!stored) {
    return fallback;
  }
  const active = getPayPeriodConfig() != null;
  return isPayPeriod(stored) === active ? stored : fallback;
}

export function isCurrentDay(day: DateLike): boolean {
  return day === currentDay();
}

// TODO: This doesn't really fit in this module anymore, should
// probably live elsewhere
export function bounds(month: DateLike): { start: number; end: number } {
  if (isPayPeriodValue(month)) {
    const { startDate, endDate } = getPayPeriodBounds(
      month,
      requirePayPeriodConfig(month),
    );
    return {
      start: parseInt(startDate.replaceAll('-', ''), 10),
      end: parseInt(endDate.replaceAll('-', ''), 10),
    };
  }
  return {
    start: parseInt(d.format(d.startOfMonth(_parse(month)), 'yyyyMMdd')),
    end: parseInt(d.format(d.endOfMonth(_parse(month)), 'yyyyMMdd')),
  };
}

export function _yearRange(
  start: DateLike,
  end: DateLike,
  inclusive = false,
): string[] {
  const years: string[] = [];
  let year = yearFromDate(start);
  const endYear = yearFromDate(end);
  while (d.isBefore(_parse(year), _parse(endYear))) {
    years.push(year);
    year = addYears(year, 1);
  }

  if (inclusive) {
    years.push(year);
  }

  return years;
}

export function yearRangeInclusive(start: DateLike, end: DateLike): string[] {
  return _yearRange(start, end, true);
}

export function _weekRange(
  start: DateLike,
  end: DateLike,
  inclusive = false,
  firstDayOfWeekIdx?: SyncedPrefs['firstDayOfWeekIdx'],
): string[] {
  const weeks: string[] = [];
  let week = weekFromDate(start, firstDayOfWeekIdx);
  const endWeek = weekFromDate(end, firstDayOfWeekIdx);
  while (d.isBefore(_parse(week), _parse(endWeek))) {
    weeks.push(week);
    week = addWeeks(week, 1);
  }

  if (inclusive) {
    weeks.push(week);
  }

  return weeks;
}

export function weekRangeInclusive(
  start: DateLike,
  end: DateLike,
  firstDayOfWeekIdx?: SyncedPrefs['firstDayOfWeekIdx'],
): string[] {
  return _weekRange(start, end, true, firstDayOfWeekIdx);
}

export function _range(
  start: DateLike,
  end: DateLike,
  inclusive = false,
): string[] {
  const startIsPeriod = isPayPeriodValue(start);
  const endIsPeriod = isPayPeriodValue(end);
  if (startIsPeriod !== endIsPeriod) {
    throw new Error(
      `Cannot create a range mixing a calendar month and a pay period ('${start}' to '${end}')`,
    );
  }
  if (startIsPeriod && endIsPeriod) {
    const config = requirePayPeriodConfig(start);
    const range = payPeriodRangeInclusive(start, end, config);
    return inclusive ? range : range.slice(0, -1);
  }

  const months: string[] = [];
  let month = monthFromDate(start);
  const endMonth = monthFromDate(end);
  while (d.isBefore(_parse(month), _parse(endMonth))) {
    months.push(month);
    month = addMonths(month, 1);
  }

  if (inclusive) {
    months.push(month);
  }

  return months;
}

export function range(start: DateLike, end: DateLike): string[] {
  return _range(start, end);
}

export function rangeInclusive(start: DateLike, end: DateLike): string[] {
  return _range(start, end, true);
}

export function _dayRange(
  start: DateLike,
  end: DateLike,
  inclusive = false,
): string[] {
  const days: string[] = [];
  let day = start;
  while (d.isBefore(_parse(day), _parse(end))) {
    days.push(dayFromDate(day));
    day = addDays(day, 1);
  }

  if (inclusive) {
    days.push(dayFromDate(day));
  }

  return days;
}

export function dayRange(start: DateLike, end: DateLike) {
  return _dayRange(start, end);
}

export function dayRangeInclusive(start: DateLike, end: DateLike) {
  return _dayRange(start, end, true);
}

export function getMonthFromIndex(year: string, monthIndex: number) {
  const formatMonth = `${monthIndex + 1}`.padStart(2, '0');
  return `${year}-${formatMonth}`;
}

export function getMonthIndex(month: string): number {
  return parseInt(month.slice(5, 7)) - 1;
}

export function getYear(month: string): string {
  return month.slice(0, 4);
}

export function getMonth(day: string): string {
  return day.slice(0, 7);
}

export function getDay(day: string): number {
  return Number(d.format(_parse(day), 'dd'));
}

export function getMonthEnd(day: string): string {
  return subDays(nextMonth(day.slice(0, 7)) + '-01', 1);
}

export function getWeekEnd(
  date: DateLike,
  firstDayOfWeekIdx?: SyncedPrefs['firstDayOfWeekIdx'],
): string {
  const converted = parseInt(firstDayOfWeekIdx || '0') as Day;
  return d.format(
    _parse(d.endOfWeek(_parse(date), { weekStartsOn: converted })),
    'yyyy-MM-dd',
  );
}

export function getYearStart(month: string): string {
  if (isPayPeriod(month)) {
    return getYear(month) + '-13';
  }
  return getYear(month) + '-01';
}

export function getYearEnd(month: string): string {
  if (isPayPeriod(month)) {
    const config = requirePayPeriodConfig(month);
    const periods = generatePayPeriods(Number(getYear(month)), config);
    return periods[periods.length - 1].monthId;
  }
  return getYear(month) + '-12';
}

export function sheetForMonth(month: string): string {
  return 'budget' + month.replace('-', '');
}

export function nameForMonth(month: DateLike, locale?: Locale): string {
  if (isPayPeriodValue(month)) {
    return getPayPeriodLabel(
      month,
      requirePayPeriodConfig(month),
      'summary',
      locale,
    );
  }
  return d.format(_parse(month), "MMMM ''yy", { locale });
}

export function format(
  month: DateLike,
  format: string,
  locale?: Locale,
): string {
  return d.format(_parse(month), format, { locale });
}

export function formatDistance(
  date1: DateLike,
  date2: DateLike,
  locale?: Locale,
  options?: { addSuffix?: boolean; includeSeconds?: boolean },
): string {
  return d.formatDistance(_parse(date1), _parse(date2), {
    locale,
    ...options,
  });
}

export const getDateFormatRegex = memoizeOne((format: string) => {
  return new RegExp(
    format
      .replace(/d+/g, '\\d{1,2}')
      .replace(/M+/g, '\\d{1,2}')
      .replace(/y+/g, '\\d{4}'),
  );
});

export const getDayMonthFormat = memoizeOne((format: string) => {
  return format
    .replace(/y+/g, '')
    .replace(/[^\w]$/, '')
    .replace(/^[^\w]/, '');
});

export const getDayMonthRegex = memoizeOne((format: string) => {
  const regex = format
    .replace(/y+/g, '')
    .replace(/[^\w]$/, '')
    .replace(/^[^\w]/, '')
    .replace(/d+/g, '\\d{1,2}')
    .replace(/M+/g, '\\d{1,2}');
  return new RegExp('^' + regex + '$');
});

export const getMonthYearFormat = memoizeOne((format: string) => {
  return format
    .replace(/d+/g, '')
    .replace(/[^\w]$/, '')
    .replace(/^[^\w]/, '')
    .replace(/\/\//, '/')
    .replace(/\.\./, '.')
    .replace(/--/, '-');
});

export const getMonthYearRegex = memoizeOne((format: string) => {
  const regex = format
    .replace(/d+/g, '')
    .replace(/[^\w]$/, '')
    .replace(/^[^\w]/, '')
    .replace(/\/\//, '/')
    .replace(/M+/g, '\\d{1,2}')
    .replace(/y+/g, '\\d{2,4}');
  return new RegExp('^' + regex + '$');
});

export const getShortYearFormat = memoizeOne((format: string) => {
  return format.replace(/y+/g, 'yy');
});

export const getShortYearRegex = memoizeOne((format: string) => {
  const regex = format
    .replace(/[^\w]$/, '')
    .replace(/^[^\w]/, '')
    .replace(/d+/g, '\\d{1,2}')
    .replace(/M+/g, '\\d{1,2}')
    .replace(/y+/g, '\\d{2}');
  return new RegExp('^' + regex + '$');
});
