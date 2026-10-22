# Installed mobile interface

The installed mobile app now uses a focused presentation alongside the existing
web interface. It shares all accounts, records, permissions and API calls.

## Activation boundary

PhoneAppProvider detects standalone/fullscreen display mode (or iOS standalone)
and a viewport at most 1023 CSS pixels wide. Only that combination enables the
new presentation. A phone browser tab, desktop browser, or wide installed window
retains the web interface. Styles are scoped to `data-phone-app="true"`.

## Changes

- A compact header replaces the two-row web chrome. Notifications stay visible;
  task/detail routes have a back-to-list link.
- Bottom navigation contains the daily destinations allowed for the current
  role. More opens every other granted destination, page search, appearance and
  account controls. No client layout choice grants server permissions.
- Safe-area spacing keeps the header and navigation clear of device insets and
  leaves room to scroll the final page controls above the bottom bar.
- Dashboard totals, handoff details and performance information expand when
  requested. The priority action remains visible. Follow-up queues initially
  show three entries, with a real Show all control for the complete queue.
- Task cards emphasize job, operation, deadline and actions. Additional context
  expands on demand. Start, complete/approval and report-problem handlers retain
  their existing business rules. Empty urgent-work groups no longer fill the
  phone; the first populated future group opens when no urgent work exists.
- Task information, files/discussion and production search/filters are
  discoverable expandable sections. Closed sections retain their mounted
  contents, so merely collapsing them does not clear input.
- Sign-in uses a shorter, top-aligned phone layout. Forms retain validation,
  permissions, submissions and errors. Phone text inputs are at least 16px.
- App launch goes through `/` so the existing role-aware routing selects the
  appropriate home. The manifest ID stays `/my-tasks`, preserving app identity.

The browser rendering of shared disclosure components returns the original
children without adding a wrapper. Default button variants and web typography,
navigation, page contents, metrics and queues are retained outside phone mode.

## Verification

Unit tests exercise presentation selection, full queue access, preserved task
actions and blocked-task behavior. Existing navigation/decision tests remain.
Core browser checks exercise the original workflow and browser layouts, plus
installed-mode screenshots at 360, 390 and 768 pixels in day/night themes,
expanded filters/information/files, role-limited navigation and returning to
the web interface at 1440 pixels.

Installed mode is emulated through matchMedia for automated checks; real Android
installation and keyboard/file-picker behavior still require staff-device QA.
This change does not introduce Web Push or change Telegram/email delivery.
