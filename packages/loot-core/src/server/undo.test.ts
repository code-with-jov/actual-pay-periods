import * as db from '#server/db';
import * as prefs from '#server/prefs';

import { runMutator } from './mutators';
import { setSyncingMode } from './sync';
import { clearUndo, redo, undo, withUndo } from './undo';

beforeEach(() => {
  setSyncingMode('disabled');
  clearUndo();
  return global.emptyDatabase()();
});

async function savePreference(id: string, value: string | null) {
  await runMutator(() =>
    withUndo(async () => {
      await db.update('preferences', { id, value });
    }),
  );
}

async function getPreferenceValue(id: string): Promise<string | null> {
  const row = await db.first<Pick<db.DbPreference, 'value'>>(
    'SELECT value FROM preferences WHERE id = ?',
    [id],
  );
  return row?.value ?? null;
}

describe('undo of a synced preference', () => {
  it('clears a preference that did not exist before instead of tombstoning it', async () => {
    void prefs.loadPrefs();

    // The `preferences` table is (id, value) with no tombstone column, so
    // undoing the very first write of a key used to emit
    // `SET tombstone = 1`, abort the transaction, and surface an
    // `invalid-schema` sync error to the user. Toggling pay periods and
    // pressing Ctrl+Z hit exactly this path.
    await savePreference('showPayPeriods', 'true');
    expect(await getPreferenceValue('showPayPeriods')).toBe('true');

    await expect(runMutator(() => undo())).resolves.toBeUndefined();

    // Cleared rather than reverted-to-missing; every reader treats an
    // empty value as unset, so pay periods read as disabled again.
    expect(await getPreferenceValue('showPayPeriods')).toBeNull();
  });

  it('redoes a preference that did not exist before', async () => {
    void prefs.loadPrefs();

    // The redo path resurrects rows by resetting their tombstone, which
    // has the same "no tombstone column" problem as the undo path.
    await savePreference('showPayPeriods', 'true');
    await runMutator(() => undo());

    await expect(runMutator(() => redo())).resolves.toBeUndefined();

    expect(await getPreferenceValue('showPayPeriods')).toBe('true');
  });

  it('restores the previous value when the preference already existed', async () => {
    void prefs.loadPrefs();

    await savePreference('showPayPeriods', 'false');
    clearUndo();

    await savePreference('showPayPeriods', 'true');
    expect(await getPreferenceValue('showPayPeriods')).toBe('true');

    await runMutator(() => undo());

    expect(await getPreferenceValue('showPayPeriods')).toBe('false');
  });
});
