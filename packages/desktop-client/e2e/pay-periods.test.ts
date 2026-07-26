import type { Page } from '@playwright/test';

import { expect, test } from './fixtures';
import type { BudgetPage } from './page-models/budget-page';
import { ConfigurationPage } from './page-models/configuration-page';
import { Navigation } from './page-models/navigation';

// Under Playwright the current date is pinned to 2017-01-01, so a biweekly
// cadence anchored on 2017-01-01 makes every period deterministic:
// '2017-13' = Jan 1 - Jan 14 is the current pay period.
const PAY_PERIOD_START_DATE = '2017-01-01';
const PAY_PERIOD_FREQUENCY_LABEL = 'Every 2 weeks';
const CURRENT_PERIOD = '2017-13';
const CURRENT_PERIOD_LABEL = 'Jan 1 - Jan 14';
const NEXT_PERIOD = '2017-14';
const NEXT_PERIOD_LABEL = 'Jan 15 - Jan 28';
const PREVIOUS_PERIOD = '2016-38';
const PREVIOUS_PERIOD_LABEL = 'Dec 18 - Dec 31';
const CURRENT_CALENDAR_MONTH = '2017-01';

function getPayPeriodCheckbox(page: Page) {
  return page.getByRole('checkbox', { name: 'Budget by pay period' });
}

async function selectPayFrequency(page: Page, frequencyLabel: string) {
  // The pay period section only mounts once the experimental flag has
  // landed; wait for it rather than racing the settings re-render.
  const frequencySelect = page.locator('#pay-period-frequency');
  await frequencySelect.waitFor({ state: 'visible', timeout: 15000 });
  await frequencySelect.click();
  await page.getByRole('button', { name: frequencyLabel, exact: true }).click();
}

/**
 * Toggles the "Budget by pay period" checkbox into the desired state.
 *
 * Clicks on the settings checkboxes can race a re-render and get lost,
 * but a click that did land resolves slowly — the synced pref (and so
 * the checkbox) only updates once the server has rebuilt every budget
 * sheet for the new mode. So lost clicks are retried, with an inner wait
 * long enough to never double-click during a legitimate in-flight save.
 */
async function togglePayPeriods(page: Page, enabled: boolean) {
  const checkbox = getPayPeriodCheckbox(page);
  await expect(checkbox).toBeEnabled();
  await expect(async () => {
    if ((await checkbox.isChecked()) !== enabled) {
      await checkbox.click();
    }
    await expect(checkbox).toBeChecked({ checked: enabled, timeout: 20000 });
  }).toPass({ timeout: 120000 });
}

/**
 * Configure a biweekly pay period cadence and turn on pay period
 * budgeting. Assumes the pay period settings section is already visible
 * (i.e. the 'Pay periods' feature flag is enabled).
 */
async function configureAndEnablePayPeriods(page: Page) {
  await selectPayFrequency(page, PAY_PERIOD_FREQUENCY_LABEL);
  await page.locator('#pay-period-start-date').fill(PAY_PERIOD_START_DATE);
  await togglePayPeriods(page, true);
}

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
    await page?.close();
  });

  test('pay period settings are hidden until the feature flag is enabled', async () => {
    const settingsPage = await navigation.goToSettingsPage();
    await settingsPage.waitFor();

    await expect(getPayPeriodCheckbox(page)).toHaveCount(0);

    await settingsPage.enableExperimentalFeature('Pay periods');

    await expect(getPayPeriodCheckbox(page)).toBeVisible();
  });

  test('budget by pay period stays disabled until the configuration is valid', async () => {
    const settingsPage = await navigation.goToSettingsPage();
    await settingsPage.enableExperimentalFeature('Pay periods');

    const checkbox = getPayPeriodCheckbox(page);
    await expect(checkbox).toBeDisabled();
    await expect(
      page.getByText(
        'Choose a pay frequency and a payday date to enable pay periods.',
      ),
    ).toBeVisible();

    // A frequency alone is not enough — a payday date is also required.
    await selectPayFrequency(page, PAY_PERIOD_FREQUENCY_LABEL);
    await expect(checkbox).toBeDisabled();

    await page.locator('#pay-period-start-date').fill(PAY_PERIOD_START_DATE);
    await expect(checkbox).toBeEnabled();

    await checkbox.click();
    await expect(checkbox).toBeChecked();
  });

  test('disabling pay periods returns the budget page to calendar months', async () => {
    const settingsPage = await navigation.goToSettingsPage();
    await settingsPage.enableExperimentalFeature('Pay periods');
    await configureAndEnablePayPeriods(page);

    // The budget page starts on the current pay period. Toggling pay
    // periods rebuilds the budget cache for every period sheet, so give
    // the mode switch extra time to settle under CI load.
    let budgetPage = await navigation.goToBudgetPage();
    await expect(budgetPage.selectedMonthButton).toHaveAttribute(
      'data-month',
      CURRENT_PERIOD,
      { timeout: 60000 },
    );

    // Turn pay periods back off; the stale pay period start month must be
    // resolved back to the current calendar month without crashing.
    await navigation.goToSettingsPage();
    await togglePayPeriods(page, false);

    budgetPage = await navigation.goToBudgetPage();
    await expect(budgetPage.selectedMonthButton).toHaveAttribute(
      'data-month',
      CURRENT_CALENDAR_MONTH,
      { timeout: 60000 },
    );
    // The visible summary is the second one in the DOM — BudgetSummaries
    // renders an off-screen summary on each side for scroll animations.
    await expect(
      budgetPage.budgetSummary.nth(1).getByText('January'),
    ).toBeVisible();
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
    await configureAndEnablePayPeriods(page);

    budgetPage = await navigation.goToBudgetPage();
    // Enabling pay periods rebuilds the budget cache for every period
    // sheet, so give the mode switch extra time to settle under CI load.
    await expect(budgetPage.selectedMonthButton).toHaveAttribute(
      'data-month',
      CURRENT_PERIOD,
      { timeout: 30000 },
    );

    // Move mouse to corner of the screen; sometimes the mouse hovers on a
    // budget element thus rendering an input box and this breaks tests.
    await page.mouse.move(0, 0);
  });

  test.afterEach(async () => {
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
