import { useEffect } from 'react';

import { listen } from '@actual-app/core/platform/client/connection';
import {
  getPayPeriodConfig,
  setPayPeriodConfig,
} from '@actual-app/core/shared/pay-period-config';
import { validatePayPeriodConfig } from '@actual-app/core/shared/pay-periods';
import type { PayPeriodConfig } from '@actual-app/core/shared/pay-periods';

import { loadPrefs } from '#prefs/prefsSlice';
import { useDispatch } from '#redux';

import { useFeatureFlag } from './useFeatureFlag';
import { useSpreadsheet } from './useSpreadsheet';
import { useSyncedPref } from './useSyncedPref';

/**
 * The active pay period configuration assembled from the feature flag and
 * synced prefs, or null when pay periods are disabled (flag off, pref
 * off, or config invalid). The single place client code derives the
 * config from prefs — don't rebuild it from prefs elsewhere.
 */
export function usePayPeriodConfig(): PayPeriodConfig | null {
  const flagEnabled = useFeatureFlag('payPeriodsEnabled');
  const [showPayPeriods] = useSyncedPref('showPayPeriods');
  const [payFrequency] = useSyncedPref('payPeriodFrequency');
  const [startDate] = useSyncedPref('payPeriodStartDate');

  if (!flagEnabled || String(showPayPeriods) !== 'true') {
    return null;
  }
  return validatePayPeriodConfig({ payFrequency, startDate });
}

/**
 * A stable identity for a pay period configuration, suitable as an effect
 * dependency: it changes whenever the budget cadence changes, including
 * when pay periods are switched off entirely.
 */
export function payPeriodConfigKey(config: PayPeriodConfig | null): string {
  return config ? `${config.payFrequency}|${config.startDate}` : 'calendar';
}

/**
 * Keeps the shared pay-period config registry (which `monthUtils` reads
 * to resolve pay period IDs) in sync with the prefs of the open budget
 * file. Mount exactly once, at the budget-scoped app root (FinancesApp).
 */
export function usePayPeriodConfigSync(): void {
  const config = usePayPeriodConfig();
  const dispatch = useDispatch();
  const spreadsheet = useSpreadsheet();

  // Update during render (idempotent) so components rendering in the
  // same pass — before effects run — already resolve pay period IDs
  // against the fresh config.
  if (payPeriodConfigKey(config) !== payPeriodConfigKey(getPayPeriodConfig())) {
    setPayPeriodConfig(config);
  }

  useEffect(() => {
    // Synced prefs sync under the `preferences` dataset, which the generic
    // prefs reload in sync-events doesn't watch, so a configuration change
    // this client didn't initiate (another device or tab, or an undo)
    // would never reach redux. The server announces those explicitly.
    return listen('pay-period-config-changed', () => {
      // Order matters: the cached values belong to the previous cadence
      // and sheet names collide across cadences, so they have to go
      // before the prefs reload re-renders the budget against the new one.
      spreadsheet.clearCache();
      void dispatch(loadPrefs());
    });
  }, [dispatch, spreadsheet]);

  useEffect(() => {
    // Deactivate when the budget file is closed; the next file's prefs
    // must not inherit this one's cadence.
    return () => {
      setPayPeriodConfig(null);
    };
  }, []);
}
