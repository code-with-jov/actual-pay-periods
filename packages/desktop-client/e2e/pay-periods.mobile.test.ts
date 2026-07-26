import { resetPayPeriodConfigForTesting } from '@actual-app/core/shared/pay-period-config';
import { amountToCurrency } from '@actual-app/core/shared/util';
import type { Page } from '@playwright/test';

import { expect, test } from './fixtures';
import { ConfigurationPage } from './page-models/configuration-page';
import type { MobileBudgetPage } from './page-models/mobile-budget-page';
import { MobileNavigation } from './page-models/mobile-navigation';
import {
  configureAndEnablePayPeriods,
  CURRENT_PERIOD,
  CURRENT_PERIOD_LABEL,
  PREVIOUS_PERIOD,
  PREVIOUS_PERIOD_LABEL,
} from './pay-period-helpers';

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
    resetPayPeriodConfigForTesting();
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
    const previousPeriod = await budgetPage.goToPreviousMonth();
    expect(previousPeriod).toBe(PREVIOUS_PERIOD);
    await expect(budgetPage.selectedBudgetMonthButton).toHaveText(
      PREVIOUS_PERIOD_LABEL,
    );

    const nextPeriod = await budgetPage.goToNextMonth();
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
    await budgetPage.goToPreviousMonth();

    const budgetAmount = 100;
    const budgetMenuModal = await budgetPage.openBudgetMenu(categoryName);
    await budgetMenuModal.setBudgetAmount(`${budgetAmount}00`);

    await budgetPage.goToNextMonth();

    const currentPeriodBudgetMenuModal =
      await budgetPage.openBudgetMenu(categoryName);
    await currentPeriodBudgetMenuModal.copyLastMonthBudget();
    await currentPeriodBudgetMenuModal.close();

    const budgetedButton = await budgetPage.getButtonForBudgeted(categoryName);

    await expect(budgetedButton).toHaveText(amountToCurrency(budgetAmount));
  });

  // Mirrors `applies budget template` in budget.mobile.test.ts, but against
  // a pay period column. The template engine resolves its windows through
  // budget columns now (see shared/months.ts budgetColumn* helpers), and
  // this is the end-to-end check that a template applied in a period lands
  // the right amount.
  test('applies a budget template within the period', async () => {
    const settingsPage = await navigation.goToSettingsPage();
    await settingsPage.enableExperimentalFeature('Goal templates');
    const uiToggle = page.getByRole('checkbox', {
      name: 'Budget automations UI',
    });
    await uiToggle.waitFor({ state: 'visible' });
    if (!(await uiToggle.isChecked())) {
      await uiToggle.click();
    }

    budgetPage = await navigation.goToBudgetPage();
    await expect(budgetPage.selectedBudgetMonthButton).toHaveText(
      CURRENT_PERIOD_LABEL,
    );

    const categoryName = await budgetPage.getCategoryNameForRow(1);
    const amountToTemplate = 123;

    const categoryMenuModal = await budgetPage.openCategoryMenu(categoryName);
    const automationsModal = await categoryMenuModal.editAutomations();
    await automationsModal
      .getByRole('button', { name: 'Add an automation' })
      .click();
    const amountField = automationsModal.locator('#amount-field');
    await amountField.fill(String(amountToTemplate));
    await amountField.press('Enter');
    await automationsModal
      .getByRole('spinbutton', { name: 'Priority' })
      .fill('0');
    await automationsModal
      .getByRole('button', { name: 'Back', exact: true })
      .click();
    await automationsModal
      .getByRole('button', { name: 'Save', exact: true })
      .click();
    await expect(automationsModal).toBeHidden();

    const budgetedButton = await budgetPage.getButtonForBudgeted(categoryName);
    // Starts at 0.00; the assertion below is what proves the template
    // engine produced a value for this *period* column.
    await expect(budgetedButton).toHaveText(amountToCurrency(0));

    const budgetMenuModal = await budgetPage.openBudgetMenu(categoryName);
    await budgetMenuModal.applyBudgetTemplate();
    await budgetMenuModal.close();

    await expect(budgetedButton).toHaveText(amountToCurrency(amountToTemplate));
  });

  test('the month menu names the period, not a calendar month', async () => {
    await budgetPage.openMonthMenu();

    const modal = page.getByRole('dialog', { name: 'Modal dialog' });
    await expect(modal).toBeVisible();
    await expect(modal).toContainText(CURRENT_PERIOD_LABEL);
  });

  test("opens a category's transactions filtered to the pay period", async () => {
    const categoryName = await budgetPage.getCategoryNameForRow(0);
    const accountPage = await budgetPage.openSpentPage(categoryName);

    await expect(accountPage.heading).toContainText(categoryName);
    await expect(accountPage.heading).toContainText(CURRENT_PERIOD_LABEL);
    await expect(accountPage.transactionList).toBeVisible();
  });
});

test.describe('Mobile Tracking budget in pay period mode', () => {
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
    test.setTimeout(180_000);

    page = await browser.newPage();
    navigation = new MobileNavigation(page);
    configurationPage = new ConfigurationPage(page);

    await page.setViewportSize({ width: 350, height: 600 });
    await page.goto('/');
    await configurationPage.createTestFile();

    const settingsPage = await navigation.goToSettingsPage();
    await settingsPage.useBudgetType('Tracking');
    await settingsPage.enableExperimentalFeature('Pay periods');
    await configureAndEnablePayPeriods(page);

    budgetPage = await navigation.goToBudgetPage();
    await expect(budgetPage.heading.locator('[data-month]')).toHaveAttribute(
      'data-month',
      CURRENT_PERIOD,
      { timeout: 30000 },
    );
  });

  test.afterEach(async () => {
    resetPayPeriodConfigForTesting();
    await page.close();
  });

  // The tracking budget reads its cells through `trackingBudgetMonth`, a
  // different server handler from the envelope budget's — this is the only
  // coverage that exercises it against pay period sheets.
  test('renders the tracking budget for the current pay period', async () => {
    await expect(budgetPage.selectedBudgetMonthButton).toHaveText(
      CURRENT_PERIOD_LABEL,
    );
    await expect(budgetPage.categoryNames.first()).toBeVisible();
  });

  test('shows the savings summary for the period', async () => {
    const summaryButton = budgetPage.page.getByRole('button', {
      name: /Saved|Projected savings|Overspent/,
    });
    await expect(summaryButton.first()).toBeVisible();
  });

  test('updates a budgeted amount in a pay period', async () => {
    const categoryName = await budgetPage.getCategoryNameForRow(0);
    const budgetMenuModal = await budgetPage.openBudgetMenu(categoryName);

    await budgetMenuModal.setBudgetAmount('12300');

    const budgetedButton = await budgetPage.getButtonForBudgeted(categoryName);
    await expect(budgetedButton).toHaveText(amountToCurrency(123));
  });
});
