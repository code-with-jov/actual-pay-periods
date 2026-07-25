import { amountToCurrency } from '@actual-app/core/shared/util';
import type { Page } from '@playwright/test';

import { expect, test } from './fixtures';
import { ConfigurationPage } from './page-models/configuration-page';
import type { MobileBudgetPage } from './page-models/mobile-budget-page';
import { MobileNavigation } from './page-models/mobile-navigation';

// Under Playwright the current date is pinned to 2017-01-01, so a biweekly
// cadence anchored on 2017-01-01 makes every period deterministic:
// '2017-13' = Jan 1 - Jan 14 is the current pay period.
const PAY_PERIOD_START_DATE = '2017-01-01';
const PAY_PERIOD_FREQUENCY_LABEL = 'Every 2 weeks';
const CURRENT_PERIOD = '2017-13';
const CURRENT_PERIOD_LABEL = 'Jan 1 - Jan 14';
const PREVIOUS_PERIOD = '2016-38';
const PREVIOUS_PERIOD_LABEL = 'Dec 18 - Dec 31';

/**
 * Configure a biweekly pay period cadence and turn on pay period
 * budgeting. Assumes the settings page is open and the 'Pay periods'
 * feature flag is enabled.
 */
async function configureAndEnablePayPeriods(page: Page) {
  // The pay period section only mounts once the experimental flag has
  // landed; wait for it rather than racing the settings re-render.
  const frequencySelect = page.locator('#pay-period-frequency');
  await frequencySelect.waitFor({ state: 'visible', timeout: 15000 });
  await frequencySelect.click();
  await page
    .getByRole('button', { name: PAY_PERIOD_FREQUENCY_LABEL, exact: true })
    .click();
  await page.locator('#pay-period-start-date').fill(PAY_PERIOD_START_DATE);

  const checkbox = page.getByRole('checkbox', {
    name: 'Budget by pay period',
  });
  await expect(checkbox).toBeEnabled();
  // Clicks on the settings checkboxes can race a re-render and get lost,
  // but a click that did land resolves slowly — the synced pref (and so
  // the checkbox) only updates once the server has rebuilt every budget
  // sheet for the new mode. So lost clicks are retried, with an inner
  // wait long enough to never double-click during an in-flight save.
  await expect(async () => {
    if (!(await checkbox.isChecked())) {
      await checkbox.click();
    }
    await expect(checkbox).toBeChecked({ timeout: 20000 });
  }).toPass({ timeout: 120000 });
}

async function goToAdjacentPeriod(
  budgetPage: MobileBudgetPage,
  direction: 'Previous period' | 'Next period',
) {
  const currentMonth = await budgetPage.getSelectedMonth();

  await budgetPage.heading.getByRole('button', { name: direction }).click();

  await expect(
    budgetPage.heading.locator('[data-month]'),
    `Failed to navigate to the ${direction.toLowerCase()}.`,
  ).not.toHaveAttribute('data-month', currentMonth);

  return budgetPage.getSelectedMonth();
}

test.describe('Mobile Budget in pay period mode', () => {
  let page: Page;
  let navigation: MobileNavigation;
  let configurationPage: ConfigurationPage;
  let budgetPage: MobileBudgetPage;
  let previousGlobalIsTesting: boolean;

  test.beforeAll(() => {
    // TODO: Hack, properly mock the currentMonth function
    previousGlobalIsTesting = global.IS_TESTING;
    global.IS_TESTING = true;
  });

  test.afterAll(() => {
    // TODO: Hack, properly mock the currentMonth function
    global.IS_TESTING = previousGlobalIsTesting;
  });

  test.beforeEach(async ({ browser }) => {
    // Enabling pay periods rebuilds every budget sheet server-side before
    // the pref save resolves; allow for that.
    test.setTimeout(180_000);

    page = await browser.newPage();
    navigation = new MobileNavigation(page);
    configurationPage = new ConfigurationPage(page);

    await page.setViewportSize({
      width: 350,
      height: 600,
    });
    await page.goto('/');
    await configurationPage.createTestFile();

    const settingsPage = await navigation.goToSettingsPage();
    await settingsPage.enableExperimentalFeature('Pay periods');
    await configureAndEnablePayPeriods(page);

    budgetPage = await navigation.goToBudgetPage();
    // Enabling pay periods rebuilds the budget cache for every period
    // sheet, so give the mode switch extra time to settle under CI load.
    await expect(budgetPage.heading.locator('[data-month]')).toHaveAttribute(
      'data-month',
      CURRENT_PERIOD,
      { timeout: 30000 },
    );
  });

  test.afterEach(async () => {
    await page.close();
  });

  test('budget page heading shows the current pay period date range', async () => {
    await expect(budgetPage.selectedBudgetMonthButton).toHaveText(
      CURRENT_PERIOD_LABEL,
    );

    // The budget table still renders its category rows in period mode.
    await expect(budgetPage.categoryNames.first()).toBeVisible();
  });

  test('previous and next period buttons navigate one period at a time', async () => {
    // One period back crosses the year boundary into 2016's last period.
    const previousPeriod = await goToAdjacentPeriod(
      budgetPage,
      'Previous period',
    );
    expect(previousPeriod).toBe(PREVIOUS_PERIOD);
    await expect(budgetPage.selectedBudgetMonthButton).toHaveText(
      PREVIOUS_PERIOD_LABEL,
    );

    const nextPeriod = await goToAdjacentPeriod(budgetPage, 'Next period');
    expect(nextPeriod).toBe(CURRENT_PERIOD);
    await expect(budgetPage.selectedBudgetMonthButton).toHaveText(
      CURRENT_PERIOD_LABEL,
    );
  });

  test('updates the budgeted amount in a pay period', async () => {
    const categoryName = await budgetPage.getCategoryNameForRow(0);
    const budgetMenuModal = await budgetPage.openBudgetMenu(categoryName);

    const budgetAmount = 123;

    // Set to 123.00
    await budgetMenuModal.setBudgetAmount(`${budgetAmount}00`);

    const budgetedButton = await budgetPage.getButtonForBudgeted(categoryName);

    await expect(budgetedButton).toHaveText(amountToCurrency(budgetAmount));
  });

  test("copies the previous period's budget", async () => {
    const categoryName = await budgetPage.getCategoryNameForRow(3);

    // Budget an amount in the previous period (crosses the year boundary).
    await goToAdjacentPeriod(budgetPage, 'Previous period');

    const budgetAmount = 100;
    const budgetMenuModal = await budgetPage.openBudgetMenu(categoryName);
    await budgetMenuModal.setBudgetAmount(`${budgetAmount}00`);

    await goToAdjacentPeriod(budgetPage, 'Next period');

    const currentPeriodBudgetMenuModal =
      await budgetPage.openBudgetMenu(categoryName);
    await currentPeriodBudgetMenuModal.copyLastMonthBudget();
    await currentPeriodBudgetMenuModal.close();

    const budgetedButton = await budgetPage.getButtonForBudgeted(categoryName);

    await expect(budgetedButton).toHaveText(amountToCurrency(budgetAmount));
  });

  test("opens a category's transactions filtered to the pay period", async () => {
    const categoryName = await budgetPage.getCategoryNameForRow(0);
    const accountPage = await budgetPage.openSpentPage(categoryName);

    await expect(accountPage.heading).toContainText(categoryName);
    await expect(accountPage.heading).toContainText(CURRENT_PERIOD_LABEL);
    await expect(accountPage.transactionList).toBeVisible();
  });
});
