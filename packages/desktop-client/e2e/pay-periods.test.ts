import { resetPayPeriodConfigForTesting } from '@actual-app/core/shared/pay-period-config';
import type { Page } from '@playwright/test';

import { expect, test } from './fixtures';
import type { BudgetPage } from './page-models/budget-page';
import { ConfigurationPage } from './page-models/configuration-page';
import { Navigation } from './page-models/navigation';
import {
  activatePayPeriodConfigForTestProcess,
  configurePayPeriodPrefs,
  CURRENT_CALENDAR_MONTH,
  CURRENT_PERIOD,
  CURRENT_PERIOD_LABEL,
  getPayPeriodToggle,
  NEXT_PERIOD,
  NEXT_PERIOD_LABEL,
  PAY_PERIOD_START_DATE,
  PREVIOUS_PERIOD,
  PREVIOUS_PERIOD_LABEL,
  togglePayPeriodsFromBudgetPage,
} from './pay-period-helpers';

test.describe('Pay period settings', () => {
  let page: Page;
  let navigation: Navigation;
  let configurationPage: ConfigurationPage;

  test.beforeEach(async ({ browser }) => {
    // Enabling or disabling pay periods rebuilds every budget sheet
    // server-side before the pref save resolves; allow for that.
    test.setTimeout(180_000);

    page = await browser.newPage();
    navigation = new Navigation(page);
    configurationPage = new ConfigurationPage(page);

    await page.goto('/');
    await configurationPage.createTestFile();
  });

  test.afterEach(async () => {
    // The shared helper activates the cadence in this process too; clear it
    // so a later test can't inherit it.
    resetPayPeriodConfigForTesting();
    await page?.close();
  });

  test.skip('pay period settings and toggle are hidden until the feature flag is enabled', async () => {
    // Skipped: `payPeriodsEnabled` now defaults to true (see
    // useFeatureFlag.ts), so this default-off assertion no longer holds.
    // Without the flag neither the settings section nor the budget page
    // toggle exists.
    let budgetPage = await navigation.goToBudgetPage();
    await budgetPage.waitFor();
    await expect(getPayPeriodToggle(page)).toHaveCount(0);

    const settingsPage = await navigation.goToSettingsPage();
    await settingsPage.waitFor();
    await expect(page.locator('#pay-period-frequency')).toHaveCount(0);

    await settingsPage.enableExperimentalFeature('Pay periods');

    // The settings only carry the configuration — the on/off toggle lives
    // on the budget page.
    await expect(page.locator('#pay-period-frequency')).toBeVisible();
    await expect(
      page.getByRole('checkbox', { name: 'Budget by pay period' }),
    ).toHaveCount(0);

    budgetPage = await navigation.goToBudgetPage();
    await budgetPage.waitFor();
    await expect(getPayPeriodToggle(page)).toBeVisible();
  });

  test('enabling from the budget page without a configuration defaults to monthly periods', async () => {
    const settingsPage = await navigation.goToSettingsPage();
    await settingsPage.enableExperimentalFeature('Pay periods');

    const budgetPage = await navigation.goToBudgetPage();
    await budgetPage.waitFor();

    // No frequency or payday has been configured; the toggle fills in a
    // monthly cadence anchored on the first of the current month, so under
    // the pinned 2017-01-01 clock the current period is still '2017-13'.
    await togglePayPeriodsFromBudgetPage(page, true);

    // The defaults surface in the settings, ready to be refined.
    await navigation.goToSettingsPage();
    await expect(page.locator('#pay-period-frequency')).toHaveText('Monthly');
    await expect(page.locator('#pay-period-start-date')).toHaveValue(
      PAY_PERIOD_START_DATE,
    );
  });

  test('disabling pay periods returns the budget page to calendar months', async () => {
    const settingsPage = await navigation.goToSettingsPage();
    await settingsPage.enableExperimentalFeature('Pay periods');
    await configurePayPeriodPrefs(page);

    // Toggling pay periods rebuilds the budget cache for every period
    // sheet, so give the mode switch extra time to settle under CI load.
    const budgetPage = await navigation.goToBudgetPage();
    await budgetPage.waitFor();
    await togglePayPeriodsFromBudgetPage(page, true);
    activatePayPeriodConfigForTestProcess();

    // Turn pay periods back off; the stale pay period start month must be
    // resolved back to the current calendar month without crashing.
    await togglePayPeriodsFromBudgetPage(page, false);

    // The visible summary is the second one in the DOM — BudgetSummaries
    // renders an off-screen summary on each side for scroll animations.
    await expect(
      budgetPage.budgetSummary.nth(1).getByText('January'),
    ).toBeVisible();
  });

  test('deactivating pay periods away from the budget page keeps the UI in sync', async () => {
    const settingsPage = await navigation.goToSettingsPage();
    await settingsPage.enableExperimentalFeature('Pay periods');
    await configurePayPeriodPrefs(page);

    let budgetPage = await navigation.goToBudgetPage();
    await budgetPage.waitFor();
    await togglePayPeriodsFromBudgetPage(page, true);
    activatePayPeriodConfigForTestProcess();

    // Turn the experimental feature itself off from the settings route.
    // That deactivates the configuration and rebuilds the budget sheets
    // back to calendar months while the budget page is unmounted; the
    // remount must follow the server — otherwise it would ask for sheets
    // that no longer exist. The pay period section unmounting is the proof
    // that the flag change landed client-side.
    await navigation.goToSettingsPage();
    await settingsPage.disableExperimentalFeature('Pay periods');
    await expect(page.locator('#pay-period-frequency')).toHaveCount(0);

    budgetPage = await navigation.goToBudgetPage();
    await expect(budgetPage.selectedMonthButton).toHaveAttribute(
      'data-month',
      CURRENT_CALENDAR_MONTH,
      { timeout: 60000 },
    );

    // No error boundary, either the route-level one or the app-level one.
    await expect(
      page.getByText('Something went wrong loading this section.'),
    ).toHaveCount(0);
    await expect(
      page.getByText('There was an unrecoverable error in the UI. Sorry!'),
    ).toHaveCount(0);

    // The table must show real calendar-month data rather than the zeroed
    // out cells of a sheet the client is no longer aligned with.
    await expect(budgetPage.budgetTable).toBeVisible();
    await expect
      .poll(() => budgetPage.getTotalSpent(), { timeout: 30000 })
      .not.toEqual(0);
  });

  // The test above undoes from the *settings* page, so the budget page
  // mounts fresh in the new mode. This one undoes while it is already on
  // screen, exercising the re-initialization path: the config registry is
  // updated during render, so for one render the requested months are in the
  // new mode while the fetched bounds are still in the old one.
  //
  // Scope note — this is a smoke test, not a regression test for the mixed
  // bounds throw. Reaching that needs the stale bounds to *start* in the
  // same calendar year as the requested month, and under Playwright the
  // clock is pinned to 2017-01-01 with a test file whose history reaches
  // back into 2016, so the bounds always start in the prior year and the
  // clamp never takes one end from each mode. The throw itself is covered by
  // src/components/budget/MonthsContext.test.ts.
  test('changing the cadence while the budget page is open does not break it', async () => {
    const settingsPage = await navigation.goToSettingsPage();
    await settingsPage.enableExperimentalFeature('Pay periods');
    await configurePayPeriodPrefs(page);

    const budgetPage = await navigation.goToBudgetPage();
    await budgetPage.waitFor();
    await togglePayPeriodsFromBudgetPage(page, true);
    activatePayPeriodConfigForTestProcess();

    // Undo the preference without leaving the page. The global handler
    // ignores the shortcut while an input has focus.
    await page.evaluate(() => {
      (document.activeElement as HTMLElement | null)?.blur();
    });
    await page.keyboard.press('Control+z');

    // The page has to survive the switch and settle into calendar months.
    await expect(budgetPage.selectedMonthButton).toHaveAttribute(
      'data-month',
      CURRENT_CALENDAR_MONTH,
      { timeout: 60000 },
    );

    await expect(
      page.getByText('Something went wrong loading this section.'),
    ).toHaveCount(0);
    await expect(
      page.getByText('There was an unrecoverable error in the UI. Sorry!'),
    ).toHaveCount(0);

    // Alive *and* showing data — a blank but un-crashed page must not pass.
    await expect(budgetPage.budgetTable).toBeVisible();
    await expect
      .poll(() => budgetPage.getTotalSpent(), { timeout: 30000 })
      .not.toEqual(0);
  });
});

test.describe('Budget in pay period mode', () => {
  let page: Page;
  let navigation: Navigation;
  let configurationPage: ConfigurationPage;
  let budgetPage: BudgetPage;

  test.beforeEach(async ({ browser }) => {
    // Enabling pay periods rebuilds every budget sheet server-side before
    // the pref save resolves; allow for that.
    test.setTimeout(180_000);

    page = await browser.newPage();
    navigation = new Navigation(page);
    configurationPage = new ConfigurationPage(page);

    await page.goto('/');
    await configurationPage.createTestFile();

    const settingsPage = await navigation.goToSettingsPage();
    await settingsPage.enableExperimentalFeature('Pay periods');
    await configurePayPeriodPrefs(page);

    budgetPage = await navigation.goToBudgetPage();
    await budgetPage.waitFor();
    // Enabling pay periods rebuilds the budget cache for every period
    // sheet; the toggle helper waits for the mode switch to settle.
    await togglePayPeriodsFromBudgetPage(page, true);
    activatePayPeriodConfigForTestProcess();

    // Move mouse to corner of the screen; sometimes the mouse hovers on a
    // budget element thus rendering an input box and this breaks tests.
    await page.mouse.move(0, 0);
  });

  test.afterEach(async () => {
    // The shared helper activates the cadence in this process too; clear it
    // so a later test can't inherit it.
    resetPayPeriodConfigForTesting();
    await page?.close();
  });

  test('renders the budget table and summary for the current pay period', async () => {
    // The visible summary is the second one in the DOM — BudgetSummaries
    // renders an off-screen summary on each side for scroll animations.
    const summary = budgetPage.budgetSummary.nth(1);

    // The summary title is the period's date range instead of a month name,
    // and the previous-period reference uses the same label style.
    await expect(summary.getByText(CURRENT_PERIOD_LABEL)).toBeVisible({
      timeout: 10000,
    });
    await expect(summary.getByText('Available funds')).toBeVisible();
    await expect(
      summary.getByText(`Overspent in ${PREVIOUS_PERIOD_LABEL}`),
    ).toBeVisible();
    await expect(summary.getByText('Budgeted')).toBeVisible();
    await expect(summary.getByText('For next month')).toBeVisible();

    // The month picker uses compact period labels ('J1' = first period
    // starting in January).
    await expect(budgetPage.selectedMonthButton).toContainText('J1');

    await expect(budgetPage.budgetTable).toBeVisible();
    expect(await budgetPage.getTableTotals()).toEqual({
      budgeted: expect.any(Number),
      spent: expect.any(Number),
      balance: expect.any(Number),
    });
  });

  test('chevrons move one period and today returns to the current period', async () => {
    // The visible summary for the selected period is the second one in the
    // DOM (BudgetSummaries keeps an off-screen summary on each side).
    const summary = budgetPage.budgetSummary.nth(1);

    await page.getByTitle('Next period').click();
    await expect(budgetPage.selectedMonthButton).toHaveAttribute(
      'data-month',
      NEXT_PERIOD,
    );
    await expect(summary.getByText(NEXT_PERIOD_LABEL)).toBeVisible();

    // Two periods back crosses the year boundary into 2016's last period.
    await page.getByTitle('Previous period').click();
    await expect(budgetPage.selectedMonthButton).toHaveAttribute(
      'data-month',
      CURRENT_PERIOD,
    );
    await page.getByTitle('Previous period').click();
    await expect(budgetPage.selectedMonthButton).toHaveAttribute(
      'data-month',
      PREVIOUS_PERIOD,
    );
    await expect(summary.getByText(PREVIOUS_PERIOD_LABEL)).toBeVisible();

    await page.getByTitle('Today').click();
    await expect(budgetPage.selectedMonthButton).toHaveAttribute(
      'data-month',
      CURRENT_PERIOD,
    );
  });

  test('edits a budgeted amount for a category in a pay period', async () => {
    await budgetPage.setBudgetedAmount('Food', '123.00');

    const foodRow = budgetPage.budgetTable
      .getByTestId('row')
      .filter({ hasText: 'Food' })
      .first();
    await expect(foodRow.getByTestId('budget')).toContainText('123.00');
  });

  test('transfers balance to another category in a pay period', async () => {
    // Pay period sheets start with nothing budgeted, so fund the source
    // category first to have a positive balance to transfer.
    const fromCategory = await budgetPage.getCategoryNameForRow(1);
    const initialFundsA = await budgetPage.getBalanceForRow(1);
    await budgetPage.setBudgetedAmount(fromCategory, '500.00');

    // Wait for the sheet to recompute the balance with the newly budgeted
    // 500.00 before sampling the amounts the transfer should move.
    await expect
      .poll(() => budgetPage.getBalanceForRow(1))
      .toEqual(initialFundsA + 50000);

    const currentFundsA = await budgetPage.getBalanceForRow(1);
    const currentFundsB = await budgetPage.getBalanceForRow(2);

    await budgetPage.transferAllBalance(1, 2);

    await expect
      .poll(() => budgetPage.getBalanceForRow(2))
      .toEqual(currentFundsA + currentFundsB);
  });

  test("copies the previous period's budgets into the current period", async () => {
    const categoryName = await budgetPage.getCategoryNameForRow(1);

    // Budget an amount in the previous period (crosses the year boundary).
    await page.getByTitle('Previous period').click();
    await expect(budgetPage.selectedMonthButton).toHaveAttribute(
      'data-month',
      PREVIOUS_PERIOD,
    );
    await budgetPage.setBudgetedAmount(categoryName, '150.00');

    await page.getByTitle('Today').click();
    await expect(budgetPage.selectedMonthButton).toHaveAttribute(
      'data-month',
      CURRENT_PERIOD,
    );

    // The visible summary is the second one in the DOM — the first is an
    // off-screen animation buffer whose buttons can't be clicked.
    const summary = budgetPage.budgetSummary.nth(1);
    await summary.getByRole('button', { name: 'Menu' }).click();
    await page
      .getByRole('button', { name: "Copy last month's budget" })
      .click();

    const categoryRow = budgetPage.budgetTable
      .getByTestId('row')
      .filter({ hasText: categoryName })
      .first();
    await expect(categoryRow.getByTestId('budget')).toContainText('150.00');
  });

  test("clicking on spent amounts opens transactions filtered to the period's day range", async () => {
    const accountPage = await budgetPage.clickOnSpentAmountForRow(1);

    expect(page.url()).toContain('/accounts');
    await expect(accountPage.accountName).toHaveText('All Accounts');

    // Pay periods don't line up with calendar months, so the drill-through
    // applies the period's actual start/end days as date filters.
    await expect(
      page.getByText('is greater than or equals 01/01/2017').first(),
    ).toBeVisible();
    await expect(
      page.getByText('is less than or equals 01/14/2017').first(),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Back' }).click();
    await budgetPage.waitFor();
  });
});
