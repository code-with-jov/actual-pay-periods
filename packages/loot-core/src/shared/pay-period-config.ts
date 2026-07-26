import type { PayPeriodConfig } from './pay-periods';
import { validatePayPeriodConfig } from './pay-periods';

/**
 * The active pay period configuration for the currently open budget file.
 *
 * loot-core models per-open-budget state (database, spreadsheet, prefs) as
 * module singletons with an explicit open/close lifecycle; this registry
 * follows the same pattern so that `months.ts` can resolve pay period IDs
 * without every one of its ~145 call sites threading a config parameter —
 * the approach that sank the previous implementation.
 *
 * Lifecycle contract — the ONLY places allowed to call setPayPeriodConfig:
 * - server: when a budget file is loaded or closed, and when any pay
 *   period preference changes (whether saved locally or applied by sync)
 * - client: at the app root, whenever the pay period synced prefs change
 * - tests: via beforeEach/afterEach using resetPayPeriodConfigForTesting
 *
 * A non-null active config means pay periods are enabled; disabled is
 * always represented as null, never as a flag on the config object.
 */
let activeConfig: PayPeriodConfig | null = null;

/**
 * Activates (or, with null, deactivates) pay periods. Invalid configs
 * deactivate rather than throw: a corrupt synced pref must never make a
 * budget file unopenable.
 */
export function setPayPeriodConfig(
  config: PayPeriodConfig | null,
): PayPeriodConfig | null {
  activeConfig = config == null ? null : validatePayPeriodConfig(config);
  return activeConfig;
}

export function getPayPeriodConfig(): PayPeriodConfig | null {
  return activeConfig;
}

export function payPeriodsActive(): boolean {
  return activeConfig != null;
}

export function resetPayPeriodConfigForTesting(): void {
  activeConfig = null;
}
