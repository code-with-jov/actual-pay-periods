import { useEffect } from 'react';

import {
  getPayPeriodConfig,
  setPayPeriodConfig,
} from '@actual-app/core/shared/pay-period-config';
import { validatePayPeriodConfig } from '@actual-app/core/shared/pay-periods';
import type { PayPeriodConfig } from '@actual-app/core/shared/pay-periods';

import { useFeatureFlag } from './useFeatureFlag';
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

function configKey(config: PayPeriodConfig | null): string | null {
  return config ? `${config.payFrequency}|${config.startDate}` : null;
}

/**
 * Keeps the shared pay-period config registry (which `monthUtils` reads
 * to resolve pay period IDs) in sync with the prefs of the open budget
 * file. Mount exactly once, at the budget-scoped app root (FinancesApp).
 */
export function usePayPeriodConfigSync(): void {
  const config = usePayPeriodConfig();

  // Update during render (idempotent) so components rendering in the
  // same pass — before effects run — already resolve pay period IDs
  // against the fresh config.
  if (configKey(config) !== configKey(getPayPeriodConfig())) {
    setPayPeriodConfig(config);
  }

  useEffect(() => {
    // Deactivate when the budget file is closed; the next file's prefs
    // must not inherit this one's cadence.
    return () => {
      setPayPeriodConfig(null);
    };
  }, []);
}
