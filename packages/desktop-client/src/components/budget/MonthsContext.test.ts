import * as monthUtils from '@actual-app/core/shared/months';
import {
  resetPayPeriodConfigForTesting,
  setPayPeriodConfig,
} from '@actual-app/core/shared/pay-period-config';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getValidMonthBounds } from './MonthsContext';

/**
 * `getValidMonthBounds` clamps the requested window to the budget's bounds
 * by comparing the two as strings. That is fine while both describe the same
 * budgeting mode, but the pay period configuration can change while the
 * budget page is mounted (an undo, or a sync from another device), and the
 * registry that resolves period IDs is updated during render — so for one
 * render the requested months are in the new mode while the bounds fetched
 * from the server are still in the old one.
 *
 * These tests pin down when that produces a mixed pair, which
 * `rangeInclusive` refuses to expand. `Budget` keeps such a pair away from
 * the renderer by tagging its bounds with the cadence they were fetched for
 * (see components/budget/index.tsx).
 */
describe('getValidMonthBounds with a stale cadence', () => {
  beforeEach(() => {
    setPayPeriodConfig({ payFrequency: 'biweekly', startDate: '2017-01-06' });
  });

  afterEach(() => {
    resetPayPeriodConfigForTesting();
  });

  it('mixes the two kinds when the clamp takes one end from each', () => {
    // Pay periods have just been switched off: the requested months are
    // calendar again, but these bounds were fetched while they were on and
    // start inside the same calendar year.
    const stalePeriodBounds = { start: '2017-13', end: '2017-38' };

    const bounds = getValidMonthBounds(stalePeriodBounds, '2017-01', '2017-03');

    // Every calendar month sorts below every pay period of the same year
    // ('2017-01' < '2017-13'), so the start clamps to the period bound while
    // the end keeps the calendar month.
    expect(bounds).toEqual({ start: '2017-13', end: '2017-03' });
    expect(() => monthUtils.rangeInclusive('2017-13', '2017-03')).toThrow(
      /mixing/,
    );
  });

  it('does not mix when the stale bounds start in an earlier year', () => {
    // The same switch-off against a budget whose data reaches back a year:
    // '2017-01' > '2016-32', so no clamp happens and both ends stay
    // calendar. This is why the hazard is invisible on a long-lived budget
    // and shows up on one whose history starts in the current year.
    const stalePeriodBounds = { start: '2016-32', end: '2017-38' };

    const bounds = getValidMonthBounds(stalePeriodBounds, '2017-01', '2017-03');

    expect(bounds).toEqual({ start: '2017-01', end: '2017-03' });
    expect(() => monthUtils.rangeInclusive('2017-01', '2017-03')).not.toThrow();
  });

  it('is unaffected once both ends describe the same mode', () => {
    const periodBounds = { start: '2017-13', end: '2017-38' };

    const bounds = getValidMonthBounds(periodBounds, '2017-14', '2017-16');

    expect(bounds).toEqual({ start: '2017-14', end: '2017-16' });
    expect(monthUtils.rangeInclusive('2017-14', '2017-16')).toEqual([
      '2017-14',
      '2017-15',
      '2017-16',
    ]);
  });
});
