import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import * as db from '#server/db';
import * as sheet from '#server/sheet';
import * as monthUtils from '#shared/months';
import {
  resetPayPeriodConfigForTesting,
  setPayPeriodConfig,
} from '#shared/pay-period-config';
import { generatePayPeriods, isPayPeriod } from '#shared/pay-periods';
import type { PayPeriodConfig } from '#shared/pay-periods';

import {
  copyPreviousMonth,
  getCategoryAverage,
  getSheetValue,
  setBudget,
} from './actions';
import { app } from './app';
import { createAllBudgets, createBudget, getBudgetRange } from './base';

// In tests the current day is 2017-01-01 (see mocks/setup.ts). With this
// config the biweekly periods of 2017 start on Jan 6, Jan 20, … and the
// last period of 2016 spans Dec 23 2016 - Jan 5 2017, so "now" belongs to
// the prior year's last period.
const biweeklyConfig: PayPeriodConfig = {
  payFrequency: 'biweekly',
  startDate: '2017-01-06',
};

const periods2016 = generatePayPeriods(2016, biweeklyConfig);
const lastPeriod2016 = periods2016[periods2016.length - 1];
const periods2017 = generatePayPeriods(2017, biweeklyConfig);

function periodById(monthId: string) {
  const year = Number(monthId.slice(0, 4));
  const period = generatePayPeriods(year, biweeklyConfig).find(
    p => p.monthId === monthId,
  );
  if (!period) {
    throw new Error(`No pay period '${monthId}' for this config`);
  }
  return period;
}

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

describe('getBudgetRange', () => {
  it('returns calendar months when pay periods are inactive', () => {
    resetPayPeriodConfigForTesting();

    const { start, end, range } = getBudgetRange('2017-01-15', '2017-01');
    expect(start).toBe('2016-10');
    expect(end).toBe('2018-01');
    expect(range.every(month => !isPayPeriod(month))).toBe(true);
    expect(range[0]).toBe(start);
    expect(range[range.length - 1]).toBe(end);
  });

  it('returns pay period IDs when pay periods are active', () => {
    const { start, end, range } = getBudgetRange('2017-01-15', '2017-01-15');

    expect(range.every(isPayPeriod)).toBe(true);
    expect(range[0]).toBe(start);
    expect(range[range.length - 1]).toBe(end);

    // ~3 calendar months of buffer before: Oct 15 2016 -> the period
    // containing Oct 1 2016 (subMonths truncates to the month).
    expect(start).toBe('2016-32');
    // ~12 calendar months after: Jan 2018 -> the period containing
    // Jan 1 2018, which is the last period of 2017 (Dec 22 - Jan 4).
    expect(end).toBe('2017-38');
    // Consecutive period IDs, in order.
    expect(range).toContain('2016-38');
    expect(range).toContain('2017-13');
    expect([...range].sort()).toEqual(range);
  });

  it('accepts pay period IDs as inputs', () => {
    const { start, end, range } = getBudgetRange('2017-13', '2017-13');

    expect(range.every(isPayPeriod)).toBe(true);
    // '2017-13' starts Jan 6; 3 months earlier is Oct 2016.
    expect(start).toBe('2016-32');
    // 12 months after Jan 6 is Jan 2018 -> the period containing Jan 1.
    expect(end).toBe('2017-38');
    expect(range[0]).toBe(start);
    expect(range[range.length - 1]).toBe(end);
  });
});

describe('createBudget with pay periods', () => {
  it('creates period sheets and seeds spending sums by date containment', async () => {
    await sheet.loadSpreadsheet(db);
    const { catId } = await setupCategories();
    await db.insertAccount({ id: 'account1', name: 'Account 1' });

    // Inserted before createBudget so the cold-build bulk seeding path
    // computes these values (rather than per-cell recomputes).
    await db.insertTransaction({
      date: periods2017[0].startDate, // 2017-01-06, inside 2017-13
      amount: -2000,
      account: 'account1',
      category: catId,
    });
    await db.insertTransaction({
      date: periods2017[1].startDate, // 2017-01-20, inside 2017-14
      amount: -5000,
      account: 'account1',
      category: catId,
    });
    // Year-boundary: Jan 3 2017 belongs to the last period of 2016
    // (Dec 23 2016 - Jan 5 2017), not to any 2017 period.
    await db.insertTransaction({
      date: '2017-01-03',
      amount: -700,
      account: 'account1',
      category: catId,
    });

    await createBudget([
      lastPeriod2016.monthId,
      periods2017[0].monthId,
      periods2017[1].monthId,
    ]);
    await sheet.waitOnSpreadsheet();

    expect(monthUtils.sheetForMonth(periods2017[0].monthId)).toBe(
      'budget201713',
    );

    const sheet2016Last = monthUtils.sheetForMonth(lastPeriod2016.monthId);
    const sheetP1 = monthUtils.sheetForMonth(periods2017[0].monthId);
    const sheetP2 = monthUtils.sheetForMonth(periods2017[1].monthId);

    expect(sheet.getCellValue(sheet2016Last, `sum-amount-${catId}`)).toBe(-700);
    expect(sheet.getCellValue(sheetP1, `sum-amount-${catId}`)).toBe(-2000);
    expect(sheet.getCellValue(sheetP2, `sum-amount-${catId}`)).toBe(-5000);
  });

  it('createAllBudgets builds a period range around the current period', async () => {
    await sheet.loadSpreadsheet(db);
    await setupCategories();

    const { start, end } = await createAllBudgets();

    expect(isPayPeriod(start)).toBe(true);
    expect(isPayPeriod(end)).toBe(true);

    const { createdMonths } = sheet.get().meta();
    // The current day (2017-01-01) falls in the last period of 2016.
    expect(createdMonths.has(lastPeriod2016.monthId)).toBe(true);
    expect([...createdMonths].every(isPayPeriod)).toBe(true);
  });
});

describe('handleTransactionChange with pay periods', () => {
  it('recomputes the sheet of the period containing the transaction date', async () => {
    await sheet.loadSpreadsheet(db);
    const { catId } = await setupCategories();
    await db.insertAccount({ id: 'account1', name: 'Account 1' });

    await createBudget([
      lastPeriod2016.monthId,
      periods2017[0].monthId,
      periods2017[1].monthId,
    ]);
    await sheet.waitOnSpreadsheet();

    // Inserted after the cold build, so the value can only appear via
    // change handling routing the recompute to the right period sheet.
    await db.insertTransaction({
      date: periods2017[1].startDate, // inside 2017-14
      amount: -3000,
      account: 'account1',
      category: catId,
    });
    await sheet.waitOnSpreadsheet();

    const sheetP1 = monthUtils.sheetForMonth(periods2017[0].monthId);
    const sheetP2 = monthUtils.sheetForMonth(periods2017[1].monthId);
    expect(sheet.getCellValue(sheetP1, `sum-amount-${catId}`)).toBe(0);
    expect(sheet.getCellValue(sheetP2, `sum-amount-${catId}`)).toBe(-3000);
  });

  it("routes a January transaction to the prior year's last period", async () => {
    await sheet.loadSpreadsheet(db);
    const { catId } = await setupCategories();
    await db.insertAccount({ id: 'account1', name: 'Account 1' });

    await createBudget([lastPeriod2016.monthId, periods2017[0].monthId]);
    await sheet.waitOnSpreadsheet();

    await db.insertTransaction({
      date: '2017-01-04', // Dec 23 2016 - Jan 5 2017 period
      amount: -1200,
      account: 'account1',
      category: catId,
    });
    await sheet.waitOnSpreadsheet();

    const sheet2016Last = monthUtils.sheetForMonth(lastPeriod2016.monthId);
    const sheetP1 = monthUtils.sheetForMonth(periods2017[0].monthId);
    expect(sheet.getCellValue(sheet2016Last, `sum-amount-${catId}`)).toBe(
      -1200,
    );
    expect(sheet.getCellValue(sheetP1, `sum-amount-${catId}`)).toBe(0);
  });
});

describe('budget actions with pay periods', () => {
  it('copy-previous-month copies budgets from the previous period', async () => {
    await sheet.loadSpreadsheet(db);
    const { catId } = await setupCategories();

    await createBudget([periods2017[0].monthId, periods2017[1].monthId]);
    await sheet.waitOnSpreadsheet();

    await setBudget({
      category: catId,
      month: periods2017[0].monthId,
      amount: 4200,
    });
    await sheet.waitOnSpreadsheet();

    await copyPreviousMonth({ month: periods2017[1].monthId });
    await sheet.waitOnSpreadsheet();

    const sheetP2 = monthUtils.sheetForMonth(periods2017[1].monthId);
    expect(await getSheetValue(sheetP2, `budget-${catId}`)).toBe(4200);
  });
});

describe('getCategoryAverage with pay periods', () => {
  it("averages period columns and ignores the other mode's budget rows", async () => {
    await sheet.loadSpreadsheet(db);
    const { catId } = await setupCategories();
    await db.insertAccount({ id: 'account1', name: 'Account 1' });

    // The current day (2017-01-01) falls in the last period of 2016, so
    // averaging from that period looks back at the periods before it.
    const current = lastPeriod2016.monthId;
    const oneBack = monthUtils.subMonths(current, 1);
    const twoBack = monthUtils.subMonths(current, 2);
    const threeBack = monthUtils.subMonths(current, 3);

    await db.insertTransaction({
      date: periodById(oneBack).startDate,
      amount: -3000,
      account: 'account1',
      category: catId,
    });
    await db.insertTransaction({
      date: periodById(twoBack).startDate,
      amount: -1000,
      account: 'account1',
      category: catId,
    });

    await createBudget([threeBack, twoBack, oneBack, current]);
    await sheet.waitOnSpreadsheet();

    // A calendar-month budget row left behind by a session with pay
    // periods disabled. 201612 sorts below every period row of the same
    // year, so an unrestricted MIN(month) reports it as the category's
    // first activity month and the average then spans periods with no
    // activity at all.
    db.runQuery(
      'INSERT INTO zero_budgets (id, month, category, amount) VALUES (?, ?, ?, ?)',
      [`201612-${catId}`, 201612, catId, 50000],
    );

    // Activity starts two periods back, so only two columns are averaged
    // no matter how far the window reaches.
    expect(
      await getCategoryAverage({
        month: current,
        maxMonths: 3,
        categoryId: catId,
      }),
    ).toBe(-2000);
    expect(
      await getCategoryAverage({
        month: current,
        maxMonths: 12,
        categoryId: catId,
      }),
    ).toBe(-2000);
  });
});

describe('category transfer requirement with pay periods', () => {
  const mustTransfer = app.handlers['must-category-transfer'];

  it('is not required for a category with no budgeted money', async () => {
    await sheet.loadSpreadsheet(db);
    const { catId } = await setupCategories();

    await createBudget([periods2017[0].monthId, periods2017[1].monthId]);
    await sheet.waitOnSpreadsheet();

    expect(await mustTransfer({ id: catId })).toBe(false);
  });

  it('is required for money budgeted in a period column', async () => {
    await sheet.loadSpreadsheet(db);
    const { catId } = await setupCategories();

    await createBudget([periods2017[0].monthId, periods2017[1].monthId]);
    await sheet.waitOnSpreadsheet();

    await setBudget({
      category: catId,
      month: periods2017[0].monthId,
      amount: 4200,
    });
    await sheet.waitOnSpreadsheet();

    expect(await mustTransfer({ id: catId })).toBe(true);
  });

  it("is required for money budgeted only in the other mode's columns", async () => {
    await sheet.loadSpreadsheet(db);
    const { catId } = await setupCategories();

    await createBudget([periods2017[0].monthId, periods2017[1].monthId]);
    await sheet.waitOnSpreadsheet();

    // Budgeted while pay periods were disabled: the calendar column has no
    // sheet in this mode, so walking the created months' sheets never sees
    // it and the money would vanish with the deleted category.
    db.runQuery(
      'INSERT INTO zero_budgets (id, month, category, amount) VALUES (?, ?, ?, ?)',
      [`201701-${catId}`, 201701, catId, 12300],
    );

    expect(await mustTransfer({ id: catId })).toBe(true);
  });
});
