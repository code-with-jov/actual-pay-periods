import React from 'react';
import { Trans } from 'react-i18next';

import { Block } from '@actual-app/components/block';
import { styles } from '@actual-app/components/styles';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';

/**
 * Shown in place of a chart that reads budgeted amounts, when the budget is
 * kept in pay periods rather than calendar months.
 *
 * These reports build calendar-month intervals and ask the budget for each
 * one. While pay periods are active those months have no budget columns, so
 * every value comes back empty and the chart would render a flat zero — a
 * wrong number presented as a fact. Saying nothing is available is the
 * honest alternative until the reports can aggregate the pay periods that
 * overlap each interval, which needs a rule for periods that straddle a
 * month boundary.
 */
export function BudgetDataUnavailable() {
  return (
    <View
      style={{
        flex: 1,
        padding: 20,
        justifyContent: 'center',
        alignItems: 'center',
        ...styles.delayedFadeIn,
      }}
    >
      <Block
        style={{
          textAlign: 'center',
          color: theme.pageTextSubdued,
          ...styles.smallText,
        }}
      >
        <Trans>
          Budget reports aren't available while you budget by pay period.
        </Trans>
      </Block>
    </View>
  );
}
