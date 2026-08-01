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

export function getPayPeriodCheckbox(page: Page) {
  return page.getByRole('checkbox', { name: 'Budget by pay period' });
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
 * Toggles the "Budget by pay period" checkbox into the desired state.
 *
 * The control is disabled for as long as the save is in flight — the server
 * cold-builds every budget column for the new mode before the pref save
 * resolves — so one click is enough; just wait for it to come back.
 */
export async function togglePayPeriods(page: Page, enabled: boolean) {
  const checkbox = getPayPeriodCheckbox(page);
  await expect(checkbox).toBeEnabled();

  if ((await checkbox.isChecked()) === enabled) {
    return;
  }

  await checkbox.click();
  await expect(checkbox).toBeChecked({ checked: enabled, timeout: 60000 });
  await expect(checkbox).toBeEnabled({ timeout: 60000 });
}

/**
 * Configure a biweekly pay period cadence and turn on pay period budgeting.
 * Assumes the pay period settings section is already visible (i.e. the 'Pay
 * periods' feature flag is enabled).
 *
 * Also activates the same cadence in the *test* process, so that helpers
 * which call `monthUtils` here — rather than driving the UI — resolve period
 * IDs instead of throwing `no pay period configuration is active`. Both come
 * from the constants above, so the test's view of the cadence cannot drift
 * from what the app was configured with. Pair with
 * `resetPayPeriodConfigForTesting()` in an afterEach.
 */
export async function configureAndEnablePayPeriods(page: Page) {
  await selectPayFrequency(page, PAY_PERIOD_FREQUENCY_LABEL);
  const startDateInput = page.locator('#pay-period-start-date');
  await startDateInput.fill(PAY_PERIOD_START_DATE);
  // The date field commits on blur/Enter rather than per keystroke, so the
  // fill alone doesn't save the pref.
  await startDateInput.press('Enter');
  await togglePayPeriods(page, true);

  setPayPeriodConfig({
    payFrequency: 'biweekly',
    startDate: PAY_PERIOD_START_DATE,
  });
}
