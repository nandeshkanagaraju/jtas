# Push notifications and interface languages

Jaraa supports English, Tamil (தமிழ்), and Hindi (हिन्दी) on the web and in the installed app. Use the language selector in the web header, phone **More** menu, login screen, or **Your account**. The choice is saved for one year in this browser/app and used for server rendering, visible interface messages, calendar controls, and push previews. Other open tabs follow the choice. Users can change it without signing out.

Job/customer names, department names maintained by administrators, comments, files, and other entered content remain as written. Email/Telegram templates, generated exports, and existing notification history retain their original language. Unknown interface messages fall back to English. Translations live in `src/lib/i18n/messages.json`; add both Tamil and Hindi entries when adding interface copy. Use `T` for explicit interface messages and `useLanguage().t` for client messages/attributes. Do not run user content through a translation lookup.

## Enable on a device

Open **Your account → Push notifications** (also available in **Notifications**), press **Enable notifications**, and allow the browser prompt. Permission is requested only after that click. Press **Send test notification** to check delivery. **Disable notifications** affects this browser/app only. Enable separately on each phone or computer. Existing installations need only close and reopen to receive the updated worker.

On iPhone/iPad, use iOS/iPadOS 16.4 or newer and open Jaraa from its Home Screen installation before enabling push. Android and supported desktop browsers can subscribe over HTTPS. A denied permission must be changed in browser/device settings. Delivery is subject to OS/browser settings, connectivity, Focus/Do Not Disturb, and the push service; provider acceptance does not prove the notification was displayed.

## Notification appearance and Indic typography

Web Push is delivered through the browser. Android/desktop may show Chrome or another browser as the sender even when the notification title and icon are Jaraa. Browser/OS attribution cannot be renamed by service-worker code; installed Android WebAPK permission delegation depends on the browser and installation type. Account includes expandable guidance and an installation link. Only test/disable remain once enabled. Test acceptance confirms a provider send, not OS display.

Notifications use the Jaraa icon, a transparent monochrome J badge for Android, and the selected locale through the Notifications API. Tamil and Hindi interfaces load self-hosted Noto Sans Tamil/Devanagari via Next font optimization. Locale-scoped typography removes English tracking, gives vowel marks more line space, and lets buttons, badges and phone navigation labels wrap. English typography is unchanged.

## Delivery

Assignments/reassignments, department handoffs, commitment windows and misses, deadline changes/reminders, overdue escalations, problems/resolutions, approval/time-extension requests, completed jobs, and daily summaries mirror the existing email notification queue to opted-in users. Comment mentions remain in the in-app inbox. Push does not replace email or Telegram. Push uses the scheduler cadence (normally five minutes), existing working-hour rules, rescheduling/cancellation, and retry backoff; it is not an immediate synchronous send.

The inbox and unread badge exclude delivery copies. Per-device delivery records prevent a retry for one failed device from resending to devices already accepted by their provider. As with any external provider, a process crash between provider acceptance and recording success can produce a repeated delivery; service-worker tags replace the previous visible notification for that event. Transient errors retry through the existing queue. Gone (404/410) subscriptions are removed.

Notification previews contain the event type and a prompt to open Jaraa, without customer, drawing, or job details on the lock screen. Clicking opens the relevant task/job or decision page; normal authentication and permissions still apply. Subscriptions are bound to an active refresh-token family. Logout/reuse revocation deletes that family's subscriptions, and delivery also checks token-family expiry, account status, and demo-recipient isolation. No browser subscription is silently rebound to another account on a shared device; a new account must explicitly enable it.

## Configure production

Generate a VAPID pair **once**, using `pnpm exec web-push generate-vapid-keys`, and store the values only in the production `.env`:

```dotenv
VAPID_PUBLIC_KEY=<public key>
VAPID_PRIVATE_KEY=<private key>
VAPID_SUBJECT=mailto:admin@jaraaglobal.com
```

Use a monitored contact URI. The private key must never be committed, printed in deployment logs, or sent to a client. The app returns only the public key to authenticated users at runtime; it is not a build argument. Keep the key pair stable across releases or existing browser subscriptions will no longer authenticate. The app and worker receive these variables through `docker-compose.prod.yml`.

The additive migration `20261023120000_web_push` adds the PUSH channel, PushSubscription, and PushDelivery. Stop the worker before migrating, deploy migrations from the new image, then restart app and worker. Never seed/reset production. The previous app can run against the additive schema for rollback; leave the new tables in place. If push is not configured, the interface says so and existing channels remain available.

Subscription writes require an active session, same-origin request, validated encryption keys, and an allowlisted HTTPS browser push endpoint to prevent arbitrary server requests. Test sends are limited to three per user per minute and to the current session's subscription. Do not log subscription endpoints or encryption keys.

## Verification

Unit tests cover language selection/persistence, translation entries, endpoint validation, localized push previews, malformed push data, and same-origin notification clicks. Integration tests use the isolated test database and mocked external push provider to cover owner/session isolation, expired endpoints, logout, queue mirroring, inbox counts, and per-device retries. Browser tests cover language persistence in web/installed layouts and the explicit enable/test/disable flow. Physical-device delivery and native translation review remain acceptance checks.
