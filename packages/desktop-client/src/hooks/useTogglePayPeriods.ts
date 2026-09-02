import { useState } from 'react';

import * as monthUtils from '@actual-app/core/shared/months';
import type { SyncedPrefs } from '@actual-app/core/types/prefs';

import { useSyncedPref } from '#hooks/useSyncedPref';
import { saveSyncedPrefs } from '#prefs/prefsSlice';
import { useDispatch } from '#redux';

/**
 * Switches pay period budgeting on or off from the budget page. Enabling
 * with an incomplete configuration would leave pay periods silently off
 * (the config would not validate), so missing prefs are defaulted to a
 * monthly cadence anchored on the first of the current month — the
 * settings page stays the place to refine them. All prefs go out in a
 * single save; the server rebuilds the budget sheets before it resolves,
 * which is what `isTogglingPayPeriods` spans.
 */
export function useTogglePayPeriods(): {
  payPeriodsActive: boolean;
  isTogglingPayPeriods: boolean;
  togglePayPeriods: () => void;
} {
  const dispatch = useDispatch();
  const [showPayPeriods] = useSyncedPref('showPayPeriods');
  const [payPeriodFrequency] = useSyncedPref('payPeriodFrequency');
  const [payPeriodStartDate] = useSyncedPref('payPeriodStartDate');
  const [isTogglingPayPeriods, setIsTogglingPayPeriods] = useState(false);

  const payPeriodsActive = String(showPayPeriods) === 'true';

  const togglePayPeriods = () => {
    if (isTogglingPayPeriods) {
      return;
    }

    const prefs: SyncedPrefs = {
      showPayPeriods: payPeriodsActive ? 'false' : 'true',
    };
    if (!payPeriodsActive) {
      if (!payPeriodStartDate) {
        prefs.payPeriodStartDate = monthUtils.firstDayOfMonth(
          monthUtils.currentDay(),
        );
      }
      if (!payPeriodFrequency) {
        prefs.payPeriodFrequency = 'monthly';
      }
    }

    setIsTogglingPayPeriods(true);
    void dispatch(saveSyncedPrefs({ prefs })).finally(() => {
      setIsTogglingPayPeriods(false);
    });
  };

  return { payPeriodsActive, isTogglingPayPeriods, togglePayPeriods };
}
