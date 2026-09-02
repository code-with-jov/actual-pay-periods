import * as monthUtils from '@actual-app/core/shared/months';
import { payPeriodsActive } from '@actual-app/core/shared/pay-period-config';
import { isPayPeriod } from '@actual-app/core/shared/pay-periods';

// Format a YYYY-MM string as "MMM yyyy" using the active locale (matching
// the convention used elsewhere in the codebase via monthUtils.format).
// Pay period IDs get their period-aware name. Falls back to the raw input
// if it doesn't look like YYYY-MM, and to "—" for empty/missing values so
// callers don't need their own guards.
export function formatMonthLabel(
  month: string | undefined | null,
  locale?: Parameters<typeof monthUtils.format>[2],
): string {
  if (!month) return '—';
  if (isPayPeriod(month)) {
    // A period ID can outlive the mode that created it (e.g. a stored
    // automation month after pay periods were turned off) — show the raw
    // ID rather than crashing on an unresolvable period.
    return payPeriodsActive() ? monthUtils.nameForMonth(month, locale) : month;
  }
  if (!monthUtils.isValidYearMonth(month)) return month;
  return monthUtils.format(month, 'MMM yyyy', locale);
}
