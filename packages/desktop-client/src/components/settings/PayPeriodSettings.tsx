import React from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Input } from '@actual-app/components/input';
import { Select } from '@actual-app/components/select';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import { send } from '@actual-app/core/platform/client/connection';
import { validatePayPeriodConfig } from '@actual-app/core/shared/pay-periods';
import type { PayFrequency } from '@actual-app/core/shared/pay-periods';

import { Checkbox, FormField, FormLabel } from '#components/forms';
import { useSyncedPref } from '#hooks/useSyncedPref';

import { Setting } from './UI';

export function PayPeriodSettings() {
  const { t } = useTranslation();
  const [showPayPeriods, setShowPayPeriods] = useSyncedPref('showPayPeriods');
  const [payPeriodFrequency, setPayPeriodFrequency] =
    useSyncedPref('payPeriodFrequency');
  const [payPeriodStartDate, setPayPeriodStartDate] =
    useSyncedPref('payPeriodStartDate');

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

  const onToggle = async () => {
    setShowPayPeriods(isEnabled ? 'false' : 'true');

    // The budget sheets are computed per budget column; switching between
    // calendar months and pay periods must recalculate them.
    await send('reset-budget-cache');
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
                onChange={newValue => {
                  if (newValue) {
                    setPayPeriodFrequency(newValue);
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
                onChangeValue={newValue => setPayPeriodStartDate(newValue)}
              />
            </FormField>
          </View>

          <Text style={{ display: 'flex' }}>
            <Checkbox
              id="settings-showPayPeriods"
              checked={isEnabled}
              disabled={!isEnabled && !validConfig}
              onChange={onToggle}
            />
            <label htmlFor="settings-showPayPeriods">
              <Trans>Budget by pay period</Trans>
            </label>
          </Text>

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
