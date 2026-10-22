# Installable app pilot

The first mobile release is the existing website installed as a Progressive Web
App (PWA). It uses the same users, permissions, jobs, attachments and backend.
There is no separate Android database or Google Play registration for this pilot.

## Installation

1. Serve the production build at a stable HTTPS address reachable by staff.
   `localhost` works for development on the same computer; the computer's plain
   HTTP LAN address is not an installable production origin on a phone.
2. Open the address in Android Chrome and sign in with the staff member's account.
3. Open the account/avatar menu, then **Install on your phone**. Use **Install
   Jaraa** when Chrome offers it, or Chrome's **Install app / Add to Home screen**
   menu. The browser controls whether and when a native install prompt is offered.
4. Open Jaraa from the home screen. Confirm that My work and job links work under
   the member's actual permissions. A signed-out launch asks for sign-in.

On iPhone/iPad, open the HTTPS address in Safari and use **Share > Add to Home
Screen**. Installation guidance also appears on the account page. Installation
does not grant additional permissions or bypass authentication.

## Pilot scope

- Standalone app window, home-screen icon and My work shortcut.
- Install instructions, native browser prompt when available, cancellation and
  error feedback, and installed/standalone confirmation.
- Current data and updates require a network connection. The service worker
  provides a connection-unavailable page; it does not cache job data or queue work.
- Email/Telegram behavior remains unchanged. Web Push has not been implemented;
  installing the app alone does not enable background phone notifications.
- Website releases update the shared application; staff do not download an APK.
  Existing open windows may need a reload to show a newly released interface.

## Real-device acceptance checklist

Pilot on at least one actual Android phone on the staff network:

- Install from the hosted HTTPS site and launch from the home screen.
- Sign in, sign out, relaunch, and check session refresh/forced password change.
- Open assigned work and drawing downloads; upload an actual supported file.
- Commit a date, complete a permitted task and report an issue on a test job.
- Confirm that a member cannot edit another department's work.
- Confirm keyboard, date/time input, scrolling and file picker behavior.
- Disconnect the network, check the offline explanation, reconnect and retry.
- Open a task link from an existing notification and verify sign-in/deep-link flow.
- Release an update and confirm a reload shows it without losing server records.

Automated browser tests validate manifest/icon availability, install prompt UI
(using a simulated browser install event), and actual service-worker offline
navigation. These checks do not install a WebAPK or replace real-device testing.
Playwright WebKit verifies registration and the cached offline page, but its
offline navigation emulation errors before displaying the worker response. That
navigation check is limited to Chromium; Safari offline recovery needs a physical
device check.

## Following phases

Validation on October 22: production build, type checks, ESLint and formatting
passed. All five installation unit tests passed. Browser checks: 11 passed and
one WebKit offline-navigation check explicitly skipped as described above. The
phone account layout screenshot was reviewed. Physical installation, hosted HTTPS
access and background phone push remain unverified/unimplemented respectively.

Confirm and implement the manufacturing changes in WORKFLOW_EVOLUTION_PLAN.md.
Add authenticated Web Push subscriptions, per-event preferences, delivery health
and acknowledgment before evaluating removal of Telegram. Push is an alert, never
proof that work was received or completed.

After a successful staff pilot, choose a Play Store packaging approach. A trusted
web activity or Capacitor package can reuse website work, but signing, verification,
store requirements and real-device QA are still separate release tasks. No Play
registration or public release has been performed.
