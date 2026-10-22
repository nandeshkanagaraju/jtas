# Jaraa / Signal frontend

The October 22 revision replaces the sidebar-based cobalt interface after review
of the owner's Safari screenshot. The site now uses warm off-white surfaces,
olive-charcoal feature panels, a burnt-copper action color, horizontal navigation,
and a larger editorial type scale. Night mode uses the same warm material palette.

## Structure and screen changes

- `src/components/shared/app-shell.tsx`: the sidebar is removed. A two-level top
  navigation contains production destinations and administration, with an accessible
  phone drawer, direct theme control, page search, account menu and notifications.
- `src/components/shared/brand.tsx`: new Jaraa wordmark and geometric mark.
- `src/app/globals.css`: rebuilt tokens, spacing, surfaces, header navigation,
  responsive metric strip, priority panel and action-register layouts.
- `src/app/(app)/dashboard/page.tsx`: a new Production overview with all six metrics
  above the priority review, followed by the action register and delivery review.
  The previous headline and explanatory message are removed.
- `src/components/dashboard/triage.tsx`: replaces the unequal side-by-side panels
  with a full-width priority feature, department route and accountable owner,
  followed by a spacious register without a nested scrolling pane.
- `src/components/dashboard/on-time-trend.tsx`: completion volume and on-time/late
  totals alongside the real 30-day chart; selected-range figures retain their scope.
- `src/components/shared/job-relay.tsx`: quieter squared route segments, slimmer
  current-owner markers and readable owner context, preserving every station state.
- Shared page headers, panels, tabs, form controls and filter bars carry the new
  system across jobs, tasks, decisions, reports, people, activity and settings.
- Jobs open in a responsive card register with the existing list option retained.
- Member workspace and primary navigation use My work; the problem page uses
  Decision inbox. Core action and validation labels remain intact.
- Authentication is rebuilt as a quiet sign-in area beside a dark workflow poster,
  with fresh product copy and the new identity.
- The job form stays disabled until hydration completes, preventing an early edit
  from being overwritten by React Hook Form initialization in Safari/WebKit.
- Application pages now use a fluid workspace without a desktop width cap. Task
  controls and comments/files sit alongside each other on wide screens; account,
  settings, holidays and My work use responsive columns and stack on phones.
- Route entrances, panel reveals, navigation indicators and interactive card
  feedback add restrained motion. Reduced-motion preferences disable entrances
  and movement effects; route animations only restart on pathname changes.

## Boundaries

The existing Next.js 15, React 19, TypeScript, Tailwind 4, Radix, React Hook Form,
Zod and Recharts stack is retained with no new dependencies. API contracts,
permissions, services, schema, workers and saved environment settings are unchanged.
Existing jobs and member reports remain real records and their words are retained.

The desktop navigation, mobile menu, theme switching and page search remain scoped
to the destinations granted by the server. Reduced motion, skip navigation and
visible keyboard focus are preserved. Main text, muted text, action text, filled
button labels and all status text/fill pairs exceed 4.5:1 in both palettes.

## Tests and rendered review

The core-loop E2E selectors were updated from My tasks to My work, and from Still
needs you to Action register. No workflow assertions were removed. A responsive
review step now checks dashboard, production and task overflow at 390, 768, 1440 and 1920 px,
cycles both themes using the real header control, and captures full-page images.
Additional checks cover full-width personal/settings pages and reduced motion.
The output is under the ignored `test-results/` directory.

Additional unit tests cover the new navigation, phone-menu access, compact theme
control and form readiness, alongside the prior problem-decision regressions.
Database-backed tests use isolated `_test` and `_e2e` databases, never `jtas_dev`.
E2E is invoked with DATABASE_URL explicitly scoped to `_e2e` because an existing
comment in the Playwright configuration prevents its intended runner-side override.

Native Safari computer control is unavailable. Rendered review uses the explicitly
requested automated browser tests and their screenshots. This does not replace a
physical bright-room shop-floor usability review.

## Final validation

- Production build passed as part of the E2E server startup.
- Application and worker type checks, ESLint, Prettier and `git diff --check` passed.
- Unit suite: **603 tests passed** across 39 files.
- Integration suite: **704 tests passed** across 27 files in the preceding redesign
  validation; this layout/motion follow-up does not change backend behavior.
- Final core E2E run: **27 tests passed**, covering desktop Chromium, Pixel mobile
  Chromium and Safari/WebKit, including the responsive screenshot review.
- Notification E2E cases: **15 passed** across the three browser projects in the
  preceding full run. Its Safari core failure was corrected and rerun above.
- The Safari failure after form readiness was fixed came from the test sorting
  commitment-based tasks by nullable deadline. It now sorts by department sequence,
  matching the production route. All dependency/state assertions remain intact.
- Captured dashboard, production and tasks at 390, 768, 1440 and 1920 px in both themes. Checked
  horizontal overflow automatically and reviewed the resulting screenshot artifacts.
- Local preview is served from the finished build at `http://localhost:3000`.
  Login responds HTTP 200. Existing development data remains at 28 jobs and 29 users.
- Physical bright-room usability and a full assistive-technology audit remain outside
  these automated and screenshot checks. The notification worker remains stopped
  for the local preview; no live notification sweep was started.
