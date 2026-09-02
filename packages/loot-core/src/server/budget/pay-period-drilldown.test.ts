import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { aqlQuery } from '#server/aql';
import * as db from '#server/db';
import * as sheet from '#server/sheet';
import * as monthUtils from '#shared/months';
import {
  resetPayPeriodConfigForTesting,
  setPayPeriodConfig,
} from '#shared/pay-period-config';
import {
  generatePayPeriods,
  getPayPeriodDateFilter,
} from '#shared/pay-periods';
import type { PayPeriodConfig } from '#shared/pay-periods';
import { q } from '#shared/query';

import { createBudget } from './base';

// Regression coverage for the "Spent vs drill-down" discrepancy: the
// budget grid computes a period's spent total with raw SQL bounded by the
// period's start AND end days (see `createCategory` in base.ts), while
// tapping that number opens a transaction list built from an AQL query
// whose date filter comes from `getPayPeriodDateFilter` (mobile
// CategoryTransactions.tsx, desktop budget index.tsx, and the category
// balance bindings in bindings.ts). Both paths must select exactly the
// same transactions; if they drift, the drill-down shows rows outside the
// period and a balance that doesn't match the tapped Spent amount.

const biweeklyConfig: PayPeriodConfig = {
  payFrequency: 'biweekly',
  startDate: '2017-01-06',
};

const periods2017 = generatePayPeriods(2017, biweeklyConfig);
// Jan 6 2017 - Jan 19 2017, the period being viewed.
const period = periods2017[0];
// Jan 20 2017 - Feb 2 2017, the period after it.
const nextPeriod = periods2017[1];

// Mirrors the query the drill-down screens build: a category filter plus
// the shared pay-period date filter for the tapped budget column. Keep in
// sync with getCategoryMonthFilter in
// desktop-client/src/components/mobile/budget/CategoryTransactions.tsx and
// categoryBalance in desktop-client/src/spreadsheet/bindings.ts.
function drillDownQuery(categoryId: string) {
  return q('transactions')
    .options({ splits: 'inline' })
    .filter({
      category: categoryId,
      date: getPayPeriodDateFilter(period.monthId, biweeklyConfig),
    });
}

async function setupSpending() {
  await db.insertCategoryGroup({ id: 'group1', name: 'Expenses' });
  await db.insertCategoryGroup({ id: 'group2', name: 'Income', is_income: 1 });
  const categoryId = await db.insertCategory({
    name: 'Entertainment',
    cat_group: 'group1',
  });
  await db.insertAccount({ id: 'account1', name: 'Account 1' });

  // Spending inside the period being viewed: -269.33 in total.
  await db.insertTransaction({
    date: period.startDate,
    amount: -20033,
    account: 'account1',
    category: categoryId,
  });
  await db.insertTransaction({
    date: period.endDate,
    amount: -6900,
    account: 'account1',
    category: categoryId,
  });

  // Spending after the period ends, belonging to the next period. The
  // drill-down for `period` must never include these.
  await db.insertTransaction({
    date: nextPeriod.startDate,
    amount: -10000,
    account: 'account1',
    category: categoryId,
  });
  await db.insertTransaction({
    date: monthUtils.addDays(nextPeriod.startDate, 4),
    amount: -8137,
    account: 'account1',
    category: categoryId,
  });

  return { categoryId };
}

beforeEach(async () => {
  await global.emptyDatabase()();
  setPayPeriodConfig(biweeklyConfig);
});

afterEach(() => {
  resetPayPeriodConfigForTesting();
});

describe('pay period drill-down transactions', () => {
  it('returns only transactions inside the tapped period', async () => {
    const { categoryId } = await setupSpending();

    const { data } = await aqlQuery(drillDownQuery(categoryId).select('*'));
    const dates = data.map((t: { date: string }) => t.date).sort();

    expect(dates).toEqual([period.startDate, period.endDate]);
  });

  it('balance matches the budget grid spent cell', async () => {
    const { categoryId } = await setupSpending();

    await sheet.loadSpreadsheet(db);
    await createBudget([period.monthId, nextPeriod.monthId]);
    await sheet.waitOnSpreadsheet();

    const sheetName = monthUtils.sheetForMonth(period.monthId);
    const spent = sheet.getCellValue(sheetName, `sum-amount-${categoryId}`);
    // Sanity-check the grid side: only the in-period transactions.
    expect(spent).toBe(-26933);

    // The header balance of the drill-down screen (categoryBalance in
    // bindings.ts) sums the same filtered query. It must agree with the
    // Spent cell the user tapped, not include later transactions.
    const { data: balance } = await aqlQuery(
      drillDownQuery(categoryId).calculate({ $sum: '$amount' }),
    );
    expect(balance).toBe(spent);
  });
});
