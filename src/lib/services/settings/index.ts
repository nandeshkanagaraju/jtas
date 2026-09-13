/** Operator-owned settings — SDD section 3.4, build spec M9.1. */
export {
  invalidateSettings,
  loadSettings,
  readSetting,
  setSettingsClock,
  settingsCacheAge,
  SETTINGS_TTL_MS,
} from './cache';
export {
  getSetting,
  getSettingArray,
  getSettingBoolean,
  getSettingNumber,
  getSettingString,
  listSettings,
  type SettingView,
} from './read';
export {
  updateSettings,
  type SettingChange,
  type SettingsActor,
  type UpdateSettingsContext,
} from './write';
