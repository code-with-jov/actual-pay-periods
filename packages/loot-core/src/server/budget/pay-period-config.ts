import * as connection from '#platform/server/connection';
import * as db from '#server/db';
import * as sheet from '#server/sheet';
import {
  getPayPeriodConfig,
  setPayPeriodConfig,
} from '#shared/pay-period-config';
import { validatePayPeriodConfig } from '#shared/pay-periods';
import type { PayPeriodConfig } from '#shared/pay-periods';

import { rebuildBudgets } from './base';

// The synced preferences that determine the active pay period
// configuration. Whenever any of them changes — via a local save or a
// CRDT sync from another device — the registry must be refreshed.
const PAY_PERIOD_PREF_IDS = [
  'flags.payPeriodsEnabled',
  'showPayPeriods',
  'payPeriodFrequency',
  'payPeriodStartDate',
] as const;

export function isPayPeriodPref(id: string): boolean {
  return (PAY_PERIOD_PREF_IDS as readonly string[]).includes(id);
}

/**
 * Reads the pay period preferences of the open budget file and returns
 * the configuration they describe, or null when pay periods are not
 * enabled (feature flag off, display pref off, or invalid/missing
 * frequency and start date).
 */
export function loadPayPeriodConfig(): PayPeriodConfig | null {
  const rows = db.runQuery<Pick<db.DbPreference, 'id' | 'value'>>(
    `SELECT id, value FROM preferences WHERE id IN (?, ?, ?, ?)`,
    [...PAY_PERIOD_PREF_IDS],
    true,
  );

  const prefs = new Map<string, string | null>();
  for (const row of rows) {
    prefs.set(row.id, row.value);
  }

  if (
    prefs.get('flags.payPeriodsEnabled') !== 'true' ||
    prefs.get('showPayPeriods') !== 'true'
  ) {
    return null;
  }

  return validatePayPeriodConfig({
    payFrequency: prefs.get('payPeriodFrequency') ?? undefined,
    startDate: prefs.get('payPeriodStartDate') ?? undefined,
  });
}

function configsEqual(
  a: PayPeriodConfig | null,
  b: PayPeriodConfig | null,
): boolean {
  if (a == null || b == null) {
    return a === b;
  }
  return a.payFrequency === b.payFrequency && a.startDate === b.startDate;
}

/**
 * Re-reads the pay period preferences and updates the registry. When the
 * active configuration actually changed, the budget sheets are rebuilt so
 * the budget columns match the new mode (calendar months vs pay periods,
 * or a different period cadence).
 *
 * This is the single funnel for every way the configuration can move — a
 * local save (server/preferences/app.ts), a change applied by sync from
 * another device or tab, and undo/redo (server/sync applyMessages) — so
 * it is also the one place that notifies the clients.
 */
export async function refreshPayPeriodConfig(): Promise<void> {
  const previousConfig = getPayPeriodConfig();
  const activeConfig = setPayPeriodConfig(loadPayPeriodConfig());

  if (configsEqual(previousConfig, activeConfig)) {
    return;
  }

  if (sheet.get()) {
    await rebuildBudgets();
  }

  // Announced only after the rebuild: the client reacts by re-reading the
  // synced prefs and re-binding the budget table, which must not happen
  // while the sheets it reads are still being rebuilt.
  connection.send('pay-period-config-changed');
}
