import { TabNav } from '@/components/shared/tab-nav';

/** The three governance screens, which share a home in the nav. */
const TABS = [
  { id: 'general', href: '/settings', label: 'General' },
  { id: 'holidays', href: '/settings/holidays', label: 'Holiday calendar' },
  { id: 'templates', href: '/settings/templates', label: 'Job templates' },
] as const;

export function SettingsNav({ current }: { current: (typeof TABS)[number]['id'] }) {
  return <TabNav tabs={TABS} current={current} label="Settings sections" />;
}
