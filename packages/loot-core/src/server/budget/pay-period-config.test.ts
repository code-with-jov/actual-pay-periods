import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as connection from '#platform/server/connection';
import * as db from '#server/db';
import * as sheet from '#server/sheet';
import {
  getPayPeriodConfig,
  resetPayPeriodConfigForTesting,
  setPayPeriodConfig,
} from '#shared/pay-period-config';

import {
  isPayPeriodPref,
  loadPayPeriodConfig,
  refreshPayPeriodConfig,
} from './pay-period-config';

/**
 * `refreshPayPeriodConfig` is the single funnel for every way the pay
 * period configuration can move — a local preference save, a change
 * applied by sync from another device, and undo/redo. These tests run it
 * against a real database and (where needed) a real spreadsheet, probing
 * the rebuild through its observable effects rather than mocks.
 */

function seedPrefs(prefs: Record<string, string>) {
  for (const [id, value] of Object.entries(prefs)) {
    db.runQuery(
      'INSERT OR REPLACE INTO preferences (id, value) VALUES (?, ?)',
      [id, value],
    );
  }
}

async function setupCategories() {
  await db.insertCategoryGroup({ id: 'group1', name: 'Expenses' });
  await db.insertCategoryGroup({ id: 'group2', name: 'Income', is_income: 1 });
  await db.insertCategory({ name: 'Food', cat_group: 'group1' });
}

const validPrefs = {
  'flags.payPeriodsEnabled': 'true',
  showPayPeriods: 'true',
  payPeriodFrequency: 'biweekly',
  payPeriodStartDate: '2017-01-06',
};

// The platform connection is already replaced with a manual mock by
// mocks/setup.ts; spy on that shared instance — a second, file-level mock
// would create a different module instance from the one the code under
// test imports.
let sendSpy: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  await global.emptyDatabase()();
  resetPayPeriodConfigForTesting();
  sendSpy = vi.spyOn(connection, 'send');
});

afterEach(() => {
  sendSpy.mockRestore();
});

afterEach(() => {
  resetPayPeriodConfigForTesting();
});

describe('loadPayPeriodConfig', () => {
  it('requires both the feature flag and the display pref', () => {
    seedPrefs({ ...validPrefs, 'flags.payPeriodsEnabled': 'false' });
    expect(loadPayPeriodConfig()).toBeNull();

    seedPrefs({ ...validPrefs, 'flags.payPeriodsEnabled': 'true' });
    seedPrefs({ showPayPeriods: 'false' });
    expect(loadPayPeriodConfig()).toBeNull();

    seedPrefs(validPrefs);
    expect(loadPayPeriodConfig()).toEqual({
      payFrequency: 'biweekly',
      startDate: '2017-01-06',
    });
  });

  it('treats an invalid stored configuration as disabled, not an error', () => {
    seedPrefs({ ...validPrefs, payPeriodStartDate: 'garbage' });
    expect(loadPayPeriodConfig()).toBeNull();

    seedPrefs({ ...validPrefs, payPeriodStartDate: '2017-02-30' });
    expect(loadPayPeriodConfig()).toBeNull();
  });
});

describe('isPayPeriodPref', () => {
  it('matches exactly the prefs that feed the configuration', () => {
    expect(isPayPeriodPref('flags.payPeriodsEnabled')).toBe(true);
    expect(isPayPeriodPref('showPayPeriods')).toBe(true);
    expect(isPayPeriodPref('payPeriodFrequency')).toBe(true);
    expect(isPayPeriodPref('payPeriodStartDate')).toBe(true);
    expect(isPayPeriodPref('budgetType')).toBe(false);
  });
});

describe('refreshPayPeriodConfig', () => {
  it('does nothing when the stored configuration matches the registry', async () => {
    seedPrefs(validPrefs);
    setPayPeriodConfig({ payFrequency: 'biweekly', startDate: '2017-01-06' });

    await refreshPayPeriodConfig();

    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('rebuilds the budget before announcing the change to clients', async () => {
    // Clients react to the announcement by re-binding the budget table, so
    // the period sheets must exist by the time it fires. The rebuild's
    // observable effect is `createdMonths` filling with period IDs; capture
    // its size at announce time.
    await sheet.loadSpreadsheet(db);
    await setupCategories();
    seedPrefs(validPrefs);

    let monthsCreatedWhenAnnounced = -1;
    sendSpy.mockImplementation((type: string) => {
      if (type === 'pay-period-config-changed') {
        monthsCreatedWhenAnnounced =
          sheet.get().meta().createdMonths?.size ?? 0;
      }
    });

    await refreshPayPeriodConfig();

    expect(getPayPeriodConfig()).toEqual({
      payFrequency: 'biweekly',
      startDate: '2017-01-06',
    });
    expect(sendSpy).toHaveBeenCalledWith('pay-period-config-changed');
    expect(monthsCreatedWhenAnnounced).toBeGreaterThan(0);
    const createdMonths = [...sheet.get().meta().createdMonths] as string[];
    expect(createdMonths.every(month => Number(month.slice(5)) >= 13)).toBe(
      true,
    );
  });

  it('deactivates and rebuilds calendar sheets when prefs turn pay periods off', async () => {
    await sheet.loadSpreadsheet(db);
    await setupCategories();
    setPayPeriodConfig({ payFrequency: 'biweekly', startDate: '2017-01-06' });
    seedPrefs({ ...validPrefs, showPayPeriods: 'false' });

    await refreshPayPeriodConfig();

    expect(getPayPeriodConfig()).toBeNull();
    expect(sendSpy).toHaveBeenCalledWith('pay-period-config-changed');
    const createdMonths = [...sheet.get().meta().createdMonths] as string[];
    expect(createdMonths.length).toBeGreaterThan(0);
    expect(createdMonths.every(month => Number(month.slice(5)) <= 12)).toBe(
      true,
    );
  });

  it('still updates the registry and announces when no budget file is open', async () => {
    seedPrefs(validPrefs);

    await refreshPayPeriodConfig();

    expect(getPayPeriodConfig()).not.toBeNull();
    expect(sendSpy).toHaveBeenCalledWith('pay-period-config-changed');
  });
});
