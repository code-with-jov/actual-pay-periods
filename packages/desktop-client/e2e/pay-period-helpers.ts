import { setPayPeriodConfig } from '@actual-app/core/shared/pay-period-config';
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * Shared setup for the pay period suites (desktop and mobile).
 *
 * Under Playwright the current date is pinned to 2017-01-01, so a biweekly
 * cadence anchored on 2017-01-01 makes every period deterministic:
 * '2017-13' = Jan 1 - Jan 14 is the current pay period.
 */
export const PAY_PERIOD_START_DATE = '2017-01-01';
export const PAY_PERIOD_FREQUENCY_LABEL = 'Every 2 weeks';
export const CURRENT_PERIOD = '2017-13';
export const CURRENT_PERIOD_LABEL = 'Jan 1 - Jan 14';
export const NEXT_PERIOD = '2017-14';
export const NEXT_PERIOD_LABEL = 'Jan 15 - Jan 28';
export const PREVIOUS_PERIOD = '2016-38';
export const PREVIOUS_PERIOD_LABEL = 'Dec 18 - Dec 31';
export const CURRENT_CALENDAR_MONTH = '2017-01';

/**
 * The toggle button in the budget page's month picker (desktop only —
 * mobile toggles through the budget page menu instead).
 */
export function getPayPeriodToggle(page: Page) {
  return page.getByRole('button', { name: 'Toggle pay period budgeting' });
}

export async function selectPayFrequency(page: Page, frequencyLabel: string) {
  // The pay period section only mounts once the experimental flag has
  // landed; wait for it rather than racing the settings re-render.
  const frequencySelect = page.locator('#pay-period-frequency');
  await frequencySelect.waitFor({ state: 'visible', timeout: 15000 });
  await frequencySelect.click();
  await page.getByRole('button', { name: frequencyLabel, exact: true }).click();
}

/**
 * Fill in the biweekly cadence on the settings page without enabling it —
 * enabling now happens from the budget page. Assumes the pay period
 * settings section is already visible (i.e. the 'Pay periods' feature flag
 * is enabled).
 */
export async function configurePayPeriodPrefs(page: Page) {
  await selectPayFrequency(page, PAY_PERIOD_FREQUENCY_LABEL);
  const startDateInput = page.locator('#pay-period-start-date');
  await startDateInput.fill(PAY_PERIOD_START_DATE);
  // The date field commits on blur/Enter rather than per keystroke, so the
  // fill alone doesn't save the pref.
  await startDateInput.press('Enter');
}

/**
 * Activate the same cadence in the *test* process, so that helpers which
 * call `monthUtils` here — rather than driving the UI — resolve period IDs
 * instead of throwing `no pay period configuration is active`. The values
 * come from the constants above, so the test's view of the cadence cannot
 * drift from what the app was configured with. Pair with
 * `resetPayPeriodConfigForTesting()` in an afterEach.
 */
export function activatePayPeriodConfigForTestProcess() {
  setPayPeriodConfig({
    payFrequency: 'biweekly',
    startDate: PAY_PERIOD_START_DATE,
  });
}

/**
 * Toggle pay periods from the desktop budget page's month picker and wait
 * for the budget to settle in the target cadence. The server cold-builds
 * every budget column for the new mode before the pref save resolves, and
 * the page re-initializes behind a spinner after that, so the settled
 * month picker is the signal that the switch is complete.
 */
export async function togglePayPeriodsFromBudgetPage(
  page: Page,
  enabled: boolean,
) {
  const toggle = getPayPeriodToggle(page);
  await expect(toggle).toBeVisible();
  await toggle.click();

  await expect(page.getByTestId('selected-budget-month')).toHaveAttribute(
    'data-month',
    enabled ? CURRENT_PERIOD : CURRENT_CALENDAR_MONTH,
    { timeout: 60000 },
  );
}
