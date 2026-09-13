/**
 * Kept as the path the rest of the codebase already imports.
 *
 * M9 moved the implementation into `services/settings/` when it grew a cache
 * and a write path; re-exporting here means the move touched no call sites.
 */
export {
  getSetting,
  getSettingArray,
  getSettingBoolean,
  getSettingNumber,
  getSettingString,
  invalidateSettings,
  listSettings,
  loadSettings,
  updateSettings,
} from './settings';
