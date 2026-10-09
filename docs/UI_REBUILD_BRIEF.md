# Brief — reimagine the JTAS interface

The interface shipped so far is a competent admin template and not much more.
This is the brief for replacing it: what the product actually is, a blunt
critique of what is wrong with the current UI so it is not reproduced, the
direction to build, and the constraints a rebuild keeps breaking.

Written to be handed to a coding agent whole. Point it at this file and at the
PDD and SDD, and have it work through section 8 in order.

---

You are the product designer and lead frontend engineer for **JTAS — Jaraa Task &
Accountability System**, the internal job-tracking application of Jaraa Global
Engineering Pvt Ltd, a CNC machining company.

Your job is to **throw away the current interface and design a new one from
first principles.** Not a palette swap, not a refinement pass — a different
product surface. The owner has looked at the current UI and does not like it.
Treat the existing design system as a thing to replace, not to extend.

The backend, database, API, authentication and business rules are finished and
correct. **You are changing only what the user sees and touches.**

---

## 1. What the product actually is

The Managing Director issues a CNC job (a part, a quantity, a drawing, a
customer, one overall deadline). The job is broken into **department subtasks**
that run in shop-flow order — Planning → Purchase → Store → Production →
Quality → Dispatch, with Accounts and HR involved on some jobs. Each department
either has a deadline set for it or commits to one itself. The system then
chases everybody automatically by email and Telegram: reminders before, overdue
mail after, escalation to the MD.

**The mental model is a baton in a relay.** One job is a baton being passed
between departments against a clock. At any moment somebody specific is holding
it, and either the clock is fine or it isn't. Everything the MD wants to know is
some projection of that: who is holding batons that are late, who is blocked,
who keeps dropping them.

The four roles:

| Role | What they open the app to do |
| --- | --- |
| `MD` | Triage. What is late, who has it, what do I decide right now. |
| `DEPUTY_MD` | The same, acting on behalf of the MD — and the record says so. |
| `MEMBER` | One question: what do I have to do, and by when. Usually on a phone, on a shop floor, sometimes with a glove on. |
| `ADMIN` | Accounts and settings. Never touches the work itself. |

The success metric the business cares about: **median time from a member
reporting a problem to the MD deciding it, under two hours.**

---

## 2. Stack and where things live

- Next.js 15 App Router, React 19, TypeScript strict
- Tailwind CSS v4 (CSS-variable theme in `src/app/globals.css`) + shadcn/ui in `src/components/ui`
- react-hook-form + Zod, Prisma + PostgreSQL, BullMQ, Vitest + Playwright, pnpm

```
src/app/(app)/…        every signed-in screen
src/app/(auth)/…       login, change-password
src/app/api/…          the API — DO NOT TOUCH
src/lib/…              services, auth policy, domain rules — DO NOT TOUCH
src/components/ui/…    shadcn primitives — restyle freely
src/components/shared/ current shared layer — replace it
```

Routes you must cover:

```
/dashboard   /jobs   /jobs/new   /jobs/[id]   /jobs/[id]/plan
/my-tasks    /tasks/[id]         /problems    /notifications
/reports     /users  /audit      /settings    /settings/holidays
/settings/templates  /account    /login       /change-password
```

### Run it locally before you design anything

```bash
pnpm install
cp .env.example .env     # then set JWT_SECRET and REFRESH_SECRET
pnpm docker:up           # Postgres, Redis, Mailpit
pnpm db:migrate && pnpm seed
pnpm seed:showcase       # ten hand-built jobs: overdue, at-risk, blocked, on hold, draft, cancelled
pnpm dev
```

`pnpm seed:showcase` prints working logins. **Use this data.** It is real
operational content — job codes like `JGE-SHOW-003`, parts like `HM-9001`,
customers like Sundaram Hydraulics, a genuine open blocker. Never invent
placeholder content, lorem ipsum, fake logos or stock photography.

---

## 3. What is wrong with the interface today — do not reproduce any of it

Open the app and look at it before you read further. Then take this as the
critique to design against:

1. **It is a generic admin template.** Left sidebar, page title, filter row,
   table. Dashboard, Jobs, Problems, Users and Audit are visually the same
   screen with different columns. Nothing about it is specific to a machine
   shop, or to a relay against a clock.
2. **The canvas is a flat beige** with hairline borders and no elevation. It
   reads as low-contrast and dated rather than calm, and on a bright shop floor
   it is genuinely hard to scan.
3. **The typography is monotonous.** Almost everything is 14px at one or two
   weights. There is no real hierarchy — just size steps that are too close
   together to create rhythm.
4. **The status colours are muddy.** The muted green/amber/red trio is so
   desaturated that urgent and ordinary look alike from two feet away.
5. **The central fact of the product is invisible.** You cannot see a job as a
   baton moving through departments against a clock anywhere except by opening
   one job and scrolling past a specification table.
6. **The MD's dashboard is a grid of boxes.** Six counts, two lists, a chart. It
   reports; it does not triage. There is no single "this is what needs you
   now, here is the decision."
7. **Nothing has any craft.** No considered motion, no depth, no moment where
   the product feels made rather than assembled.

---

## 4. The direction to build

Build a **control room**: an instrument panel for a shop, not a CRUD admin.
Confident, high-contrast, information-dense where the data is and generous
where the decisions are. It should feel like a tool a serious operation paid
for — closer to Linear, Vercel's dashboard or Mercury than to a Bootstrap
admin — while staying unmistakably about *machining jobs and deadlines*.

**Decide these yourself; this is the brief, not the spec:**

- **Surfaces — dark is the primary theme.** A deep neutral canvas, never pure
  black: `#000` on an OLED phone makes text bloom and smear, and it kills the
  sense of depth. Work from roughly `#0E1013`–`#14171B` and go *lighter* as
  things come forward — canvas, then panel, then raised — because on dark,
  elevation is carried by surface lightness and a hairline, not by shadow.
  Shadows exist only under things that genuinely float (a dialog, a drawer, a
  menu). Light is a **complete second theme**, designed at the same time rather
  than derived by inverting values — see the daylight requirement below.
- **Accent.** One saturated accent that is clearly *not* the status palette, so
  "this is a button" and "this is late" can never be confused. On a dark canvas
  it has to carry a white or near-black label at 4.5:1 without glowing — an
  instrument blue or a cobalt around 55–65% lightness does this; a neon does
  not.
- **Status.** Four genuinely distinguishable tones for late / at-risk /
  in-progress / done, each with a text, a fill and a border value, verified at
  4.5:1 in **both** themes. On dark, a fully saturated red vibrates against the
  background and is tiring to sit in front of: pull saturation down and
  lightness up relative to the light theme, and get contrast from the tinted
  fill and its border rather than from raw chroma. Loud enough to read across a
  desk, never the only signal — always a word too.
- **Typography — use these faces.**
  - **Geist Sans** for everything: UI, body, tables, and headings. Load via
    `next/font/google` if it is published there, otherwise the `geist` npm
    package through `next/font/local`.
  - **Geist Mono** for job codes, part numbers, drawing numbers, quantities,
    timestamps, countdowns, metrics, and the station labels on the relay.

  One superfamily, deliberately. The current UI's problem is not too few faces,
  it is too narrow a scale — everything sits at 14px in two weights. Build
  hierarchy from **size, weight and tracking** instead: a page title around
  28–32px at 600 with roughly `-0.02em` tracking, section headings at 15–16px
  at 600, body at 14px at 400, supporting labels at 12–13px at 500. Then let
  **the mono carry the character.** Using it structurally — every job code,
  every deadline, every number in a table — is what will make this read as an
  instrument panel rather than a website, and it is the cheapest distinctive
  decision available. Enable tabular figures (`tnum`) everywhere numbers stack
  in a column. On dark, drop one weight step from what you would use on light;
  text gains apparent weight against a dark ground. No all-caps labels anywhere
  except at most one page-level kicker.
- **Density.** Two modes by intent, not one compromise: the MD's screens are
  dense and scannable; the member's screens are large, high-contrast and
  thumb-sized.
- **Motion.** Short (120–200ms), purposeful, and only where it explains a
  change — a row leaving a queue, a drawer arriving, a status flipping. Fully
  disabled under `prefers-reduced-motion`.

> **The one risk dark-first carries, and your job to close it.** Members read
> My Tasks and the task detail on a phone, on a shop floor, often in daylight
> coming through a roller door. A dark screen in that light is harder to read
> than a light one. So: the theme must follow the device by default, with a
> switch the member can reach in one tap; the light theme must be as finished
> as the dark one, not an afterthought; and you must check the member screens
> at full brightness in a bright room before you call them done. If a member
> screen only works in the dark, it is not done.

### The signature ideas — build these, they are the point

1. **`<JobRelay>` — the baton visualisation.** One component, three densities,
   used everywhere:
   - *inline* (a row in the jobs list): a compact horizontal track of
     department segments, filled for done, hollow for pending, marked where the
     baton is now, red where it is late. Readable at a glance, no labels.
   - *card* (the dashboard, a job card): the same track with department labels
     and the current holder named.
   - *full* (job detail): the hero of the screen — each department a station on
     the track with its owner, its date, its state, its problems, expandable
     for history and actions.
   This replaces today's "Departments" column, which prints the same five words
   on every single row, and today's subtask list.
2. **The MD dashboard is a triage console, not a report.** Lead with one
   decision: the single most urgent thing, named, with the person, the elapsed
   time and a primary action. Behind it, a prioritised queue of everything else
   that needs them, in one ordered list rather than four boxes. Push the
   counts and the completion chart below that — they are review, not decisions.
3. **My Tasks is a focused worklist, not an accordion of lists.** A member with
   one overdue task should see that task, large, with its two actions, and
   nothing else competing. Everything not due now collapses to a count.
   Thumb-sized targets, high contrast, no text under 14px.
4. **The problem inbox is a decision queue.** Opening one should feel like
   working a queue: the member's words verbatim, the context needed to decide,
   the five resolutions, and the ability to move to the next without going back
   to a list. Keyboard-drivable end to end.

---

## 5. Hard constraints — breaking these breaks the product

**Do not touch at all:** `src/app/api/**`, `src/lib/**`, `src/middleware.ts`,
`prisma/**`, `worker/**`, `scripts/**`. No schema changes, no new API routes,
and no new dependencies beyond the font packages named in section 4. If a
screen needs a field the DTO does not carry, redesign the screen — do not
change the service.

**Keep every permission exactly as it is.** Server-side `can()` gates and
`forbidden()` calls stay. Never show an action a role cannot perform, and never
weaken a check to make a screen easier to build.

**Keep JTAS semantics intact:**

- **Overdue is a condition, not a state.** A subtask can be `IN_PROGRESS` *and*
  overdue at the same time. Show both facts. Never collapse them into one chip
  that says "Overdue" and loses what the department is actually doing. The
  states are `PENDING BLOCKED IN_PROGRESS PROBLEM AWAITING_APPROVAL COMPLETED
  ON_HOLD CANCELLED`.
- **A member cannot change their own deadline.** They can *request* more time;
  the MD decides. The UI must make that asymmetry obvious and must never
  present an editable deadline to a member.
- **A committed date is binding.** When a member commits a date it becomes the
  deadline and they cannot edit it.
- **Problems keep severity and a recorded decision.** Severity
  (`LOW MEDIUM HIGH BLOCKER`), the member's description verbatim, and the MD's
  written decision are all part of the record. A rejection requires a reason.
- **Deputy actions stay attributable** as acting on behalf of the MD wherever
  the data says so.
- **A completed subtask's lateness is measured against its completion time,**
  not against now. (This was a live bug once; don't reintroduce it.)

**The end-to-end suite encodes a contract.** `tests/e2e/core-loop.spec.ts` finds
things by accessible role and name. You may restructure freely, but these must
keep working — or you must update the spec in the same commit and say so:

```
getByLabel('Job title')                getByLabel(/part number/i)
button 'Save draft and continue'       button /^Apply/
button /^Review \(5\)$/                button 'Publish job'
locator('article') containing a job code   (My Tasks cards)
button /^<BucketLabel> \d/             (collapsed task groups)
button 'Start work' | 'Mark completed' | 'Report problem' | 'Blocker' | 'Cancel'
getByRole('row') containing a job code  (problems table rows must stay rows —
                                         never put role="button" on a <tr>)
getByRole('dialog')                     (the problem drawer)
button 'Mark as seen' | 'Resolve it' | 'Resolve'
radio 'Give more time'
heading 'Problems'
```

---

## 6. Screen brief

Design the shared system first, then every screen on it. No screen gets a
one-off header, panel, empty state or filter row.

| Screen | Must answer |
| --- | --- |
| **MD/Deputy dashboard** | What needs me right now, and what do I do about it. Then: at-risk and overdue work, open problems, on-time performance, recent accountability activity. |
| **Jobs list** | Search and filter by status, priority, department; priority, customer, part, overall deadline, progress, where the baton is, and whether anything under it is late. Active filters must be visible and removable. |
| **Job detail** | The relay, full size, as the hero. Job facts as a compact card, not an eight-row specification. Department-by-department state, owners, exact deadlines, problems, files, and the full activity history. MD actions (publish, hold, cancel, edit) where status and permission allow. |
| **New job + plan wizard** | Three clear steps with real progress. The plan step must show the chain and flag any subtask that runs past the job's own deadline. |
| **My Tasks** | Grouped by urgency and due window, owners and exact deadlines, and fast In Progress / Completed / Problem actions. Optimistic, with honest rollback on failure. |
| **Task detail** | Everything needed to decide, above the actions. Commitment panel when a date is owed. Request-more-time panel that explains the asymmetry. Comments and files. |
| **Problem inbox + detail** | Severity, age (red past 24h), job and department context, the member's words, full history, and the five MD resolutions with their consequences spelled out. |
| **Notifications** | Unread state, what was sent, and why anything was withheld. |
| **Reports** | Department scorecards and a single job's full record, both range-scoped and linkable. |
| **Audit** | An append-only forensic log with filters, expandable field-level diffs, and CSV export. Say plainly that it cannot be edited — that is what makes it evidence. |
| **Users / Settings / Holidays / Templates / Account** | Admin surfaces on the same system. Settings must keep its live "with these values…" preview. |

---

## 7. Everything that is not the happy path

For every screen, implement and actually verify:

- **Loading** — skeletons shaped like the content that is coming, so the page
  does not jump. Never a lone spinner in an empty box, and never an empty state
  shown while data is still in flight.
- **Empty** — distinguish "nothing exists yet" from "nothing matches your
  filters". The second must offer a way out.
- **Error** — say what failed, keep the user's filters, and offer a retry that
  does not reload the page. Never report an empty list when what happened was a
  failed request.
- **Permission** — a role that cannot act sees why, not a dead button.
- **Success** — confirm with the consequence ("Sent for approval", "3 tasks are
  no longer blocked"), not just "Saved".
- Designed `not-found`, `error` and `forbidden` pages.

**Accessibility, non-negotiable:** full keyboard operation with a visible focus
style, a skip link, semantic landmarks and headings, 4.5:1 contrast in both
themes, 44px touch targets on coarse pointers, `prefers-reduced-motion`
honoured globally, and status never signalled by colour alone.

**Both themes, every screen.** Nothing ships verified in one theme only, and
the member's phone screens are checked in daylight as well — see the note at
the end of section 4.

**Responsive:** design the phone layout for the shop floor on its own terms —
not a desktop page squeezed into 390px. Tables become cards or lists; nothing
important hides behind a horizontal scroll; the primary action is always in
reach of a thumb.

---

## 8. How to work

1. **Look first.** Run the app with the showcase data. Open every route as the
   MD and as a member. Read `docs/JARAA_PDD_Product_Design_Document.md` and
   `docs/JARAA_SDD_Software_Design_Document.md` (authoritative for business
   rules). Note anywhere the docs and the implementation disagree — preserve
   the implementation unless it is plainly a UI defect.
2. **Write the system before the screens.** Tokens in `globals.css`, fonts,
   then the shared components — app shell, page header, panel/surface, data
   table, empty/error/loading states, filter bar, status primitives, and
   `<JobRelay>`. Every screen must be assembled from these.
3. **Rebuild screen by screen**, running the app and looking at each one at
   390px and 1440px, in both themes, before moving on.
4. **Do not stop at the first version that compiles.** Look at each screen and
   ask whether it is better than a table. If it isn't, redo it.

## 9. Validation before you call it done

Run these and report the real output — do not claim a check you did not run:

```bash
pnpm typecheck
pnpm lint
pnpm exec prettier --check "src/**/*.{ts,tsx,css}"
pnpm build
pnpm test:unit
pnpm test:integration
pnpm test:e2e
```

Everything that passed before must still pass. If you changed an e2e selector,
update the spec in the same commit and say which and why. Attachment tests need
MinIO and notification e2e needs Mailpit — both come up with `pnpm docker:up`.

**Done means:** every route redesigned on one shared system; both themes
complete; phone layouts designed, not squeezed; all five state types
implemented per screen; permissions and JTAS semantics unchanged; all checks
green; and you can state in one paragraph what the design direction is and why
it suits a machine shop.

## 10. Do not

Ship a generic admin template · use lorem ipsum, fake customers, invented logos
or stock images · add a second UI framework or an unnecessary dependency ·
weaken a permission check · invent a workflow the backend does not support ·
remove working functionality · fill space with decorative metrics or charts
nobody asked for · use gradients, glassmorphism or a giant empty hero · leave
inconsistent one-off components · pad the page with whitespace and call it
design.
