import React, { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { AnimatedLoading } from '@actual-app/components/icons/AnimatedLoading';
import { Input } from '@actual-app/components/input';
import { Select } from '@actual-app/components/select';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import { validatePayPeriodConfig } from '@actual-app/core/shared/pay-periods';
import type { PayFrequency } from '@actual-app/core/shared/pay-periods';
import type { SyncedPrefs } from '@actual-app/core/types/prefs';

import { Checkbox, FormField, FormLabel } from '#components/forms';
import { useSyncedPref } from '#hooks/useSyncedPref';
import { saveSyncedPrefs } from '#prefs/prefsSlice';
import { useDispatch } from '#redux';

import { Setting } from './UI';

export function PayPeriodSettings() {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const [showPayPeriods] = useSyncedPref('showPayPeriods');
  const [payPeriodFrequency] = useSyncedPref('payPeriodFrequency');
  const [payPeriodStartDate] = useSyncedPref('payPeriodStartDate');

  // Every one of these prefs can change the active pay period
  // configuration, and doing so rebuilds every budget sheet from scratch
  // before the save resolves. Mutators are serialized server-side, so
  // without this the controls would just look frozen for several seconds.
  const [isSaving, setIsSaving] = useState(false);

  const isEnabled = String(showPayPeriods) === 'true';
  const validConfig = validatePayPeriodConfig({
    payFrequency: payPeriodFrequency,
    startDate: payPeriodStartDate,
  });

  const frequencyOptions: Array<[PayFrequency | '', string]> = [
    ['weekly', t('Weekly')],
    ['biweekly', t('Every 2 weeks')],
    ['monthly', t('Monthly')],
  ];

  async function savePref(prefs: SyncedPrefs) {
    setIsSaving(true);
    try {
      await dispatch(saveSyncedPrefs({ prefs }));
    } finally {
      setIsSaving(false);
    }
  }

  const onToggle = () => {
    // Saving the pref is enough: the server rebuilds the budget sheets
    // whenever the active pay period configuration changes (see
    // loot-core server/budget/pay-period-config.ts).
    void savePref({ showPayPeriods: isEnabled ? 'false' : 'true' });
  };

  return (
    <Setting
      primaryAction={
        <View style={{ gap: 15 }}>
          <View style={{ flexDirection: 'row', gap: '1em' }}>
            <FormField>
              <FormLabel
                title={t('Pay frequency')}
                htmlFor="pay-period-frequency"
              />
              <Select
                id="pay-period-frequency"
                options={frequencyOptions}
                value={(payPeriodFrequency ?? '') as PayFrequency | ''}
                defaultLabel={t('Choose a frequency')}
                disabled={isSaving}
                onChange={newValue => {
                  if (newValue) {
                    void savePref({ payPeriodFrequency: newValue });
                  }
                }}
              />
            </FormField>
            <FormField>
              <FormLabel
                title={t('Date of a payday')}
                htmlFor="pay-period-start-date"
              />
              <Input
                id="pay-period-start-date"
                type="date"
                value={payPeriodStartDate ?? ''}
                disabled={isSaving}
                onChangeValue={newValue =>
                  void savePref({ payPeriodStartDate: newValue })
                }
              />
            </FormField>
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Text style={{ display: 'flex' }}>
              <Checkbox
                id="settings-showPayPeriods"
                checked={isEnabled}
                disabled={isSaving || (!isEnabled && !validConfig)}
                onChange={onToggle}
              />
              <label htmlFor="settings-showPayPeriods">
                <Trans>Budget by pay period</Trans>
              </label>
            </Text>
            {isSaving && (
              <View
                style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
                aria-live="polite"
              >
                <AnimatedLoading width={14} height={14} />
                <Text style={{ color: theme.pageTextSubdued }}>
                  <Trans>Rebuilding your budget…</Trans>
                </Text>
              </View>
            )}
          </View>

          {!validConfig && (
            <Text style={{ color: theme.warningText }}>
              {isEnabled ? (
                <Trans>
                  Pay periods stay off until the pay frequency and payday date
                  are valid.
                </Trans>
              ) : (
                <Trans>
                  Choose a pay frequency and a payday date to enable pay
                  periods.
                </Trans>
              )}
            </Text>
          )}
        </View>
      }
    >
      <Text>
        <Trans>
          <strong>Pay periods</strong> let you budget by your actual pay
          schedule — weekly, every two weeks, or monthly — instead of by
          calendar month. Pick how often you are paid and the date of any one of
          your paydays; your budget columns will then follow that cadence.
        </Trans>
      </Text>
    </Setting>
  );
}
