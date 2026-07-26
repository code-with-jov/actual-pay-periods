// @ts-strict-ignore
import React, { useEffect, useEffectEvent, useMemo, useState } from 'react';
import type { ComponentType } from 'react';

import { AnimatedLoading } from '@actual-app/components/icons/AnimatedLoading';
import { styles } from '@actual-app/components/styles';
import { View } from '@actual-app/components/view';
import { send } from '@actual-app/core/platform/client/connection';
import * as monthUtils from '@actual-app/core/shared/months';
import { getPayPeriodDateFilter } from '@actual-app/core/shared/pay-periods';
import type {
  CategoryEntity,
  CategoryGroupEntity,
} from '@actual-app/core/types/models';

import {
  useBudgetActions,
  useDeleteCategoryGroupMutation,
  useDeleteCategoryMutation,
  useReorderCategoryGroupMutation,
  useReorderCategoryMutation,
  useSaveCategoryGroupMutation,
  useSaveCategoryMutation,
  useSortCategoriesMutation,
} from '#budget';
import { useCategories } from '#hooks/useCategories';
import { useGlobalPref } from '#hooks/useGlobalPref';
import { useLocalPref } from '#hooks/useLocalPref';
import { useNavigate } from '#hooks/useNavigate';
import {
  payPeriodConfigKey,
  usePayPeriodConfig,
} from '#hooks/usePayPeriodConfig';
import { SheetNameProvider } from '#hooks/useSheetName';
import { useSpreadsheet } from '#hooks/useSpreadsheet';
import { useSyncedPref } from '#hooks/useSyncedPref';

import { AutoSizingBudgetTable } from './DynamicBudgetTable';
import * as envelopeBudget from './envelope/EnvelopeBudgetComponents';
import { EnvelopeBudgetProvider } from './envelope/EnvelopeBudgetContext';
import * as trackingBudget from './tracking/TrackingBudgetComponents';
import { TrackingBudgetProvider } from './tracking/TrackingBudgetContext';
import { prewarmAllMonths, prewarmMonth } from './util';

export function Budget() {
  const payPeriodConfig = usePayPeriodConfig();
  const currentMonth = monthUtils.currentBudgetMonth();
  const spreadsheet = useSpreadsheet();
  const navigate = useNavigate();
  const [summaryCollapsed, setSummaryCollapsedPref] = useLocalPref(
    'budget.summaryCollapsed',
  );
  const [startMonthPref, setStartMonthPref] = useLocalPref('budget.startMonth');
  // A stored start month from the other mode (e.g. a calendar month while
  // pay periods are active, or vice versa) must not leak into month math —
  // mixing the two kinds produces broken ranges.
  const startMonth = monthUtils.resolveStartMonth(startMonthPref, currentMonth);
  // `bounds` is tagged with the cadence it was fetched for. The registry
  // that resolves pay period IDs is updated *during* render (see
  // usePayPeriodConfigSync), so on the render where the cadence flips,
  // `startMonth` is already expressed in the new mode while this state
  // still holds the old mode's bounds. Rendering the table with that pair
  // throws (`rangeInclusive` refuses to mix a calendar month and a pay
  // period), so the tag lets the gate below reject the stale pair in the
  // same render rather than one effect later.
  const [bounds, setBounds] = useState(() => ({
    start: startMonth,
    end: startMonth,
    configKey: payPeriodConfigKey(payPeriodConfig),
  }));
  const [budgetType = 'envelope'] = useSyncedPref('budgetType');
  const [maxMonthsPref] = useGlobalPref('maxMonths');
  const maxMonths = maxMonthsPref || 1;
  const [initialized, setInitialized] = useState(false);
  const { data: { grouped: categoryGroups } = { grouped: [] } } =
    useCategories();

  const init = useEffectEvent(() => {
    async function run() {
      // Captured before the await: if the cadence changes again while this
      // request is in flight, the bounds it returns describe the cadence
      // that was active when it was sent, not the one active when it
      // resolves.
      const requestedConfigKey = payPeriodConfigKey(payPeriodConfig);
      const { start, end } = await send('get-budget-bounds');
      setBounds({ start, end, configKey: requestedConfigKey });

      await prewarmAllMonths(
        budgetType,
        spreadsheet,
        { start, end },
        startMonth,
      );

      setInitialized(true);
    }

    void run();
  });

  // The bounds and the prewarmed cells are expressed in the units of the
  // active budget cadence (calendar months or pay period IDs), so both go
  // stale when the pay period configuration changes. That normally happens
  // on the settings route (this page is unmounted), but a change synced
  // from another device — or an undo — can land while the budget is on
  // screen, so re-run the initialization and re-gate the table on it.
  const configKey = payPeriodConfigKey(payPeriodConfig);
  useEffect(() => {
    setInitialized(false);
    init();
  }, [configKey]);

  const loadBoundBudgets = useEffectEvent(() => {
    const requestedConfigKey = payPeriodConfigKey(payPeriodConfig);
    void send('get-budget-bounds').then(({ start, end }) => {
      if (bounds.start !== start || bounds.end !== end) {
        setBounds({ start, end, configKey: requestedConfigKey });
      }
    });
  });
  useEffect(() => loadBoundBudgets(), []);

  const onMonthSelect = async (month, numDisplayed) => {
    setStartMonthPref(month);

    const warmingMonth = month;

    // We could be smarter about this, but this is a good start. We
    // optimize for the case where users press the left/right button
    // to move between months. This loads the month data all at once
    // and "prewarms" the spreadsheet cache. This uses a simple
    // heuristic that will fail if the user clicks an arbitrary month,
    // but it will just load in some unnecessary data.
    if (month < startMonth) {
      // pre-warm prev month
      await prewarmMonth(
        budgetType,
        spreadsheet,
        monthUtils.subMonths(month, 1),
      );
    } else if (month > startMonth) {
      // pre-warm next month
      await prewarmMonth(
        budgetType,
        spreadsheet,
        monthUtils.addMonths(month, numDisplayed),
      );
    }

    if (warmingMonth === month) {
      setStartMonthPref(month);
    }
  };

  const onToggleCollapse = () => {
    setSummaryCollapsedPref(!summaryCollapsed);
  };

  const onApplyBudgetTemplatesInGroup = async categories => {
    applyBudgetAction.mutate({
      month: startMonth,
      type: 'apply-multiple-templates',
      args: {
        categories,
      },
    });
  };

  const onShowActivity = (categoryId, month) => {
    // Pay periods don't line up with calendar months, so filter by the
    // period's actual day range instead of the `month` shorthand.
    const dateFilter = getPayPeriodDateFilter(month, payPeriodConfig);
    const dateConditions =
      '$gte' in dateFilter
        ? [
            {
              field: 'date',
              op: 'gte',
              value: dateFilter.$gte,
              type: 'date',
            },
            {
              field: 'date',
              op: 'lte',
              value: dateFilter.$lte,
              type: 'date',
            },
          ]
        : [
            {
              field: 'date',
              op: 'is',
              value: month,
              options: { month: true },
              type: 'date',
            },
          ];
    const filterConditions = [
      { field: 'category', op: 'is', value: categoryId, type: 'id' },
      ...dateConditions,
    ];
    void navigate('/accounts', {
      state: {
        goBack: true,
        filterConditions,
        categoryId,
      },
    });
  };

  const saveCategory = useSaveCategoryMutation();
  const onSaveCategory = category => {
    saveCategory.mutate({ category });
  };
  const deleteCategory = useDeleteCategoryMutation();
  const onDeleteCategory = id => {
    deleteCategory.mutate({ id });
  };
  const reorderCategory = useReorderCategoryMutation();
  const saveCategoryGroup = useSaveCategoryGroupMutation();
  const onSaveCategoryGroup = group => {
    saveCategoryGroup.mutate({ group });
  };
  const deleteCategoryGroup = useDeleteCategoryGroupMutation();
  const onDeleteCategoryGroup = id => {
    deleteCategoryGroup.mutate({ id });
  };
  const reorderCategoryGroup = useReorderCategoryGroupMutation();
  const sortCategories = useSortCategoriesMutation();
  const applyBudgetAction = useBudgetActions();

  const onBudgetAction = (month, type, args) => {
    applyBudgetAction.mutate({ month, type, args });
  };

  // `bounds.configKey !== configKey` catches the render where the cadence
  // has already flipped but the refetched bounds haven't arrived yet.
  if (!initialized || bounds.configKey !== configKey || !categoryGroups) {
    return (
      <View
        style={{
          ...styles.page,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <AnimatedLoading width={25} height={25} />
      </View>
    );
  }

  let table;
  if (budgetType === 'tracking') {
    table = (
      <TrackingBudgetProvider
        summaryCollapsed={summaryCollapsed}
        onBudgetAction={onBudgetAction}
        onToggleSummaryCollapse={onToggleCollapse}
      >
        <AutoSizingBudgetTable
          type={budgetType}
          prewarmStartMonth={startMonth}
          startMonth={startMonth}
          monthBounds={bounds}
          maxMonths={maxMonths}
          onMonthSelect={onMonthSelect}
          onDeleteCategory={onDeleteCategory}
          onDeleteGroup={onDeleteCategoryGroup}
          onSaveCategory={onSaveCategory}
          onSaveGroup={onSaveCategoryGroup}
          onBudgetAction={onBudgetAction}
          onShowActivity={onShowActivity}
          onReorderCategory={reorderCategory.mutate}
          onReorderGroup={reorderCategoryGroup.mutate}
          onApplyBudgetTemplatesInGroup={onApplyBudgetTemplatesInGroup}
          onSortCategories={(groupId, direction) =>
            sortCategories.mutate({ groupId, direction })
          }
        />
      </TrackingBudgetProvider>
    );
  } else {
    table = (
      <EnvelopeBudgetProvider
        summaryCollapsed={summaryCollapsed}
        onBudgetAction={onBudgetAction}
        onToggleSummaryCollapse={onToggleCollapse}
      >
        <AutoSizingBudgetTable
          type={budgetType}
          prewarmStartMonth={startMonth}
          startMonth={startMonth}
          monthBounds={bounds}
          maxMonths={maxMonths}
          onMonthSelect={onMonthSelect}
          onDeleteCategory={onDeleteCategory}
          onDeleteGroup={onDeleteCategoryGroup}
          onSaveCategory={onSaveCategory}
          onSaveGroup={onSaveCategoryGroup}
          onBudgetAction={onBudgetAction}
          onShowActivity={onShowActivity}
          onReorderCategory={reorderCategory.mutate}
          onReorderGroup={reorderCategoryGroup.mutate}
          onApplyBudgetTemplatesInGroup={onApplyBudgetTemplatesInGroup}
          onSortCategories={(groupId, direction) =>
            sortCategories.mutate({ groupId, direction })
          }
        />
      </EnvelopeBudgetProvider>
    );
  }

  return (
    <SheetNameProvider name={monthUtils.sheetForMonth(startMonth)}>
      {/*
        In a previous iteration, the wrapper needs `overflow: hidden` for
        some reason. Without it at certain dimensions the width/height
        that autosizer gives us is slightly wrong, causing scrollbars to
        appear. We might not need it anymore?
      */}
      <View
        style={{
          ...styles.page,
          paddingLeft: 8,
          paddingRight: 8,
          overflow: 'hidden',
        }}
      >
        <View style={{ flex: 1 }}>{table}</View>
      </View>
    </SheetNameProvider>
  );
}

export type BudgetSummaryProps = {
  month: string;
};

export type CategoryMonthProps = {
  month: string;
  category: CategoryEntity;
  editing: boolean;
  isLast?: boolean;
  onEdit: (id: CategoryEntity['id'] | null, month?: string) => void;
  onBudgetAction: (month: string, action: string, arg: unknown) => void;
  onShowActivity: (id: CategoryEntity['id'], month: string) => void;
};

export type CategoryGroupMonthProps = {
  month: string;
  group: CategoryGroupEntity;
};

export type BudgetComponents = {
  SummaryComponent: ComponentType<BudgetSummaryProps>;
  ExpenseCategoryComponent: ComponentType<CategoryMonthProps>;
  ExpenseGroupComponent: ComponentType<CategoryGroupMonthProps>;
  IncomeCategoryComponent: ComponentType<CategoryMonthProps>;
  IncomeGroupComponent: ComponentType<CategoryGroupMonthProps>;
  BudgetTotalsComponent: ComponentType;
  IncomeHeaderComponent: ComponentType;
};

export function useBudgetComponents(): BudgetComponents {
  const [budgetType = 'envelope'] = useSyncedPref('budgetType');
  const envelopeComponents = useEnvelopeBudgetComponents();
  const trackingComponents = useTrackingBudgetComponents();

  return budgetType === 'envelope' ? envelopeComponents : trackingComponents;
}

function useTrackingBudgetComponents(): BudgetComponents {
  return useMemo(
    () => ({
      SummaryComponent: trackingBudget.BudgetSummary,
      ExpenseCategoryComponent: trackingBudget.ExpenseCategoryMonth,
      ExpenseGroupComponent: trackingBudget.ExpenseGroupMonth,
      IncomeCategoryComponent: trackingBudget.IncomeCategoryMonth,
      IncomeGroupComponent: trackingBudget.IncomeGroupMonth,
      BudgetTotalsComponent: trackingBudget.BudgetTotalsMonth,
      IncomeHeaderComponent: trackingBudget.IncomeHeaderMonth,
    }),
    [],
  );
}

function useEnvelopeBudgetComponents(): BudgetComponents {
  return useMemo(
    () => ({
      SummaryComponent: envelopeBudget.BudgetSummary,
      ExpenseCategoryComponent: envelopeBudget.ExpenseCategoryMonth,
      ExpenseGroupComponent: envelopeBudget.ExpenseGroupMonth,
      IncomeCategoryComponent: envelopeBudget.IncomeCategoryMonth,
      IncomeGroupComponent: envelopeBudget.IncomeGroupMonth,
      BudgetTotalsComponent: envelopeBudget.BudgetTotalsMonth,
      IncomeHeaderComponent: envelopeBudget.IncomeHeaderMonth,
    }),
    [],
  );
}
