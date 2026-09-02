import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import * as db from '#server/db';
import * as sheet from '#server/sheet';
import * as monthUtils from '#shared/months';
import {
  resetPayPeriodConfigForTesting,
  setPayPeriodConfig,
} from '#shared/pay-period-config';
import { generatePayPeriods } from '#shared/pay-periods';
import type { PayPeriodConfig } from '#shared/pay-periods';

import { getSheetValue, setBudget } from './actions';
import { createBudget } from './base';
import { applySingleCategoryTemplate } from './goal-template';

/**
 * Integration coverage for the goal template engine under pay periods,
 * against a REAL database and spreadsheet.
 *
 * The unit tests in category-template-context.pay-periods.test.ts mock
 * `getSheetValue` to return 0, which cannot tell the fixed code from the bug
 * it fixed: reading a calendar sheet that pay period mode never creates also
 * yields 0, silently. These tests read the real `budget-<id>` cell instead,
 * so the assertion is on the money rather than on which sheet names a mock
 * was handed.
 */

// The test clock is pinned to 2017-01-01 (see mocks/setup.ts). With this
// cadence the 2017 periods start Jan 6, Jan 20, Feb 3, … and "now" falls in
// the last period of 2016 (Dec 23 - Jan 5).
const biweeklyConfig: PayPeriodConfig = {
  payFrequency: 'biweekly',
  startDate: '2017-01-06',
};

const periods2016 = generatePayPeriods(2016, biweeklyConfig);
const LAST_PERIOD_2016 = periods2016[periods2016.length - 1].monthId;
const FIRST_PERIOD_2017 = '2017-13'; // Jan 6 - Jan 19
const SECOND_PERIOD_2017 = '2017-14'; // Jan 20 - Feb 2

async function setupCategories() {
  await db.insertCategoryGroup({ id: 'group1', name: 'Expenses' });
  await db.insertCategoryGroup({ id: 'group2', name: 'Income', is_income: 1 });
  const catId = await db.insertCategory({ name: 'Food', cat_group: 'group1' });
  return { catId };
}

beforeEach(async () => {
  await global.emptyDatabase()();
  setPayPeriodConfig(biweeklyConfig);
});

afterEach(() => {
  resetPayPeriodConfigForTesting();
});

describe('goal templates against real pay period sheets', () => {
  it('spend counts what earlier period columns already contributed', async () => {
    await sheet.loadSpreadsheet(db);
    const { catId } = await setupCategories();

    await createBudget([
      LAST_PERIOD_2016,
      FIRST_PERIOD_2017,
      SECOND_PERIOD_2017,
    ]);
    await sheet.waitOnSpreadsheet();

    // $300 already set aside towards the goal, in a period column that has
    // already elapsed. This is the value the buggy version threw away: it
    // walked calendar months and read 'budget201701', a sheet pay period
    // mode never creates, which reads back as 0 instead of raising.
    await setBudget({
      category: catId,
      month: FIRST_PERIOD_2017,
      amount: 30000,
    });
    await sheet.waitOnSpreadsheet();

    // "$1200 by March, saving from January."
    await db.update('notes', {
      id: catId,
      note: '#template 1200 by 2017-03 spend from 2017-01',
    });

    await applySingleCategoryTemplate({
      month: SECOND_PERIOD_2017,
      category: catId,
    });
    await sheet.waitOnSpreadsheet();

    // The deadline resolves to the period containing Mar 31 2017, five
    // columns after this one, so six columns share the remaining $900.
    const target = 120000;
    const alreadyBudgeted = 30000;
    const columnsRemaining = monthUtils.budgetColumnDistance(
      SECOND_PERIOD_2017,
      monthUtils.budgetColumnForCalendarMonth('2017-03', 'end'),
    );
    expect(columnsRemaining).toBe(5);

    const expected = Math.round(
      (target - alreadyBudgeted) / (columnsRemaining + 1),
    );
    expect(expected).toBe(15000);

    expect(
      await getSheetValue(
        monthUtils.sheetForMonth(SECOND_PERIOD_2017),
        `budget-${catId}`,
      ),
    ).toBe(expected);
  });

  it('by divides the goal across budget columns, not calendar months', async () => {
    await sheet.loadSpreadsheet(db);
    const { catId } = await setupCategories();

    await createBudget([FIRST_PERIOD_2017, SECOND_PERIOD_2017]);
    await sheet.waitOnSpreadsheet();

    // "$600 by March."
    await db.update('notes', {
      id: catId,
      note: '#template 600 by 2017-03',
    });

    await applySingleCategoryTemplate({
      month: SECOND_PERIOD_2017,
      category: catId,
    });
    await sheet.waitOnSpreadsheet();

    const budgeted = await getSheetValue(
      monthUtils.sheetForMonth(SECOND_PERIOD_2017),
      `budget-${catId}`,
    );

    // Six periods reach the deadline, so $100 each. Counting the two
    // calendar months instead would put aside $200 a period and fund the
    // goal a full cadence early, at the expense of every other category.
    expect(budgeted).toBe(10000);

    const calendarMonthsRemaining = monthUtils.differenceInCalendarMonths(
      '2017-03',
      SECOND_PERIOD_2017,
    );
    expect(budgeted).toBeLessThan(
      Math.round(60000 / (calendarMonthsRemaining + 1)),
    );
  });
});
