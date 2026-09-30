# Module-Wise Build Prompts
## Jaraa Task & Accountability System (JTAS)
**Use with:** Claude Code, Cursor, or any coding agent
**Companion documents:** `JARAA_PDD_Product_Design_Document.md`, `JARAA_SDD_Software_Design_Document.md`

---

## How to use this file

1. Build the modules **in order**. Each one assumes the previous ones are merged and green.
2. Before each prompt, paste the **Standing context** block below once per session.
3. Keep the PDD and SDD in the repo at `/docs` and tell the agent to read them.
4. After each module, run the stated acceptance checks before moving on. Do not let the
   agent start M7 (notifications) until M4 and M5 are genuinely working — the scheduler is
   the hardest part to debug on top of shaky foundations.

---

## Standing context (paste at the start of every session)

```
You are building an internal web application for Jaraa Global Engineering Pvt Ltd,
a CNC manufacturing company, called JTAS (Jaraa Task & Accountability System).

The design documents are in /docs:
  - docs/JARAA_PDD_Product_Design_Document.md   (what to build)
  - docs/JARAA_SDD_Software_Design_Document.md  (how to build it — authoritative for
    schema, API, business rules and the notification engine)

Read both before writing code. If anything in my prompt conflicts with the SDD, follow
the SDD and tell me about the conflict.

Stack, non-negotiable:
  Next.js 15 App Router, React 19, TypeScript strict, Tailwind CSS, shadcn/ui,
  Prisma + PostgreSQL 16, BullMQ + Redis, Nodemailer, Zod, react-hook-form,
  TanStack Query, Vitest, Playwright, pnpm, Docker Compose.

Rules you must follow throughout:
  1. All timestamps stored in UTC. Display and business-hours maths in Asia/Kolkata
     using date-fns-tz. Never construct a deadline from a naive local string server-side.
  2. Business logic lives in lib/services/* and lib/domain/*, never in React components
     or route handlers. Route handlers only: authenticate, validate with Zod, call a
     service, map errors to HTTP.
  3. Authorisation is enforced server-side in every route handler via a single
     can(user, action, resource) function in lib/auth/policy.ts. Hiding a UI button is
     never the access control.
  4. Zod schemas are shared between client and server — one definition per shape, in
     lib/validation/*.
  5. Every state-changing operation writes an AuditLog row inside the same transaction.
  6. No hard deletes on User, Job, Subtask or Problem. Deactivate or cancel instead.
  7. Errors return { error: { code, message, details? } } with the codes listed in the SDD.
  8. Write tests as you go. Do not leave a module without tests for its business rules.
  9. Keep files under ~300 lines. Split by responsibility, not by arbitrary size.
 10. Use pnpm. Commit in small logical commits with conventional-commit messages.

Work module by module. At the end of each module, print: files created/changed, how to
run it, how to verify it, and anything you deliberately deferred.
```

---

## M0 — Project foundation

**Prompt**

```
Build module M0: project foundation. Nothing user-facing yet.

Deliver:
1. pnpm + Next.js 15 App Router + TypeScript strict project at the repo root.
   Path alias @/* -> ./src/*. ESLint + Prettier + a pre-commit hook (husky +
   lint-staged) running typecheck, lint and vitest on changed files.
2. Tailwind CSS + shadcn/ui initialised. Install: button, input, textarea, select,
   label, card, table, badge, dialog, sheet, drawer, dropdown-menu, tabs, toast,
   form, calendar, popover, alert, separator, avatar, skeleton.
3. Directory structure exactly:
   src/app, src/components/ui, src/components/shared,
   src/lib/{auth,db,domain,services,notifications,validation,utils},
   src/lib/db/prisma.ts (singleton client, safe under hot reload),
   prisma/, tests/{unit,integration,e2e}, worker/, docs/
4. Prisma initialised against PostgreSQL. Implement the FULL schema from SDD section
   3.3 verbatim — all models and all enums. Generate the first migration.
5. Seed script (prisma/seed.ts) creating:
   - the 8 departments with sequenceOrder:
     Planning 1, Purchase 2, Store 3, Production 4, Quality 5, Dispatch 6,
     Accounts 7, HR 8
   - one MD user (md@jaraaglobal.com) and one member per department
     (planning@, purchase@, store@, production@, quality@, dispatch@, accounts@, hr@),
     all with temporary password "Jaraa@2026" and mustChangePassword = true
   - all Setting rows with the defaults in SDD section 3.4
   - one JobTemplate named "Standard CNC Job" with 8 JobTemplateItems using the default
     CNC dependency chain from the PDD (Planning -> Purchase -> Store -> Production ->
     Quality -> Dispatch -> Accounts, with HR in parallel) and sensible
     offsetHoursBeforeDue values for a typical 15-day job
6. docker-compose.yml with services: db (postgres:16 + volume), redis (redis:7
   appendonly), mailpit (SMTP capture for local dev, UI on 8025). App and worker run
   on the host during development.
7. .env.example documenting every variable in SDD section 10.3, plus README.md with
   setup, migrate, seed, dev, test and worker commands.
8. lib/utils/time.ts with: toIST(date), fromISTInput(string), formatIST(date, pattern),
   hoursBetween(a,b). Unit-tested.
9. GitHub Actions workflow: install -> typecheck -> lint -> vitest -> build, with a
   Postgres service container.

Acceptance: `pnpm dlx prisma migrate dev && pnpm seed && pnpm dev` works from a clean
clone following README only; `pnpm test` passes; CI is green.
```

---

## M1 — Authentication and RBAC

**Prompt**

```
Build module M1: authentication and role-based access control.

Deliver:
1. lib/auth/password.ts — bcrypt cost 12 hash/verify; policy: min 8 chars, at least one
   letter and one digit; reject the 20 most common passwords.
2. lib/auth/jwt.ts — using jose: 15-minute access token and 30-day refresh token, both
   in httpOnly + Secure + SameSite=Lax cookies. Refresh rotation with family
   invalidation on reuse (store a token family id and version on the user or in a
   RefreshToken table — add the model via migration if you need it).
3. lib/auth/session.ts — getSession() for RSC, requireAuth(roles?) for route handlers.
4. lib/auth/policy.ts — can(user, action, resource) implementing the FULL authorisation
   matrix in SDD section 6.3. Actions as a string-literal union, exhaustively switched
   so a new action cannot be forgotten. Unit-test every cell of the matrix.
5. Routes: POST /api/auth/login, POST /api/auth/logout,
   POST /api/auth/change-password, GET /api/auth/me.
   Login: lock the account for 15 minutes after 5 failed attempts; increment
   failedLoginCount; reset on success; set lastLoginAt; block inactive users; return
   mustChangePassword so the client can redirect.
6. Rate limiting on /api/auth/* — 10 requests/minute/IP. In-memory limiter behind an
   interface so it can move to Redis later.
7. Next middleware: unauthenticated -> /login; authenticated with
   mustChangePassword -> /change-password (allow only that route and logout);
   role-based landing — MD/DEPUTY_MD -> /dashboard, ADMIN -> /users,
   MEMBER -> /my-tasks.
8. Screens: /login (email, password, error states, no self-signup link anywhere) and
   /change-password (current, new, confirm with a strength hint). Mobile-first.
9. Audit log entries for LOGIN_SUCCESS, LOGIN_FAILED, LOGOUT, PASSWORD_CHANGED,
   ACCOUNT_LOCKED, with IP address.

Acceptance: seeded MD logs in, is forced to change the password, lands on /dashboard
(a placeholder page is fine); a member landing on /dashboard gets 403; 5 bad passwords
lock the account; policy unit tests cover the whole matrix.
```

---

## M2 — Directory: users and departments

**Prompt**

```
Build module M2: user and department administration.

Deliver:
1. Service lib/services/userService.ts: list (filter by role, department, active,
   search), create, update, deactivate, resetPassword.
   - Create generates a temporary password, sets mustChangePassword, and returns the
     temp password ONCE in the response (never stored in plain text, never logged).
   - Deactivate must refuse with code CONFLICT if the user has open subtasks
     (status not in COMPLETED/CANCELLED), and the error details must list those
     subtasks. Accept an optional reassignTo user id that moves them in the same
     transaction — validate the target is active and in the same department.
   - Email is unique and lower-cased. Role MEMBER requires a departmentId; MD, DEPUTY_MD
     and ADMIN must not have one.
2. Routes: GET/POST /api/users, PATCH/DELETE /api/users/:id,
   POST /api/users/:id/reset-password, GET /api/departments. MD and ADMIN only.
3. Screen /users: table (name, email, role, department, last login, status), search,
   role/department filters, create and edit dialogs, deactivate confirmation that shows
   open subtasks and offers a reassignment target, reset-password dialog that displays
   the temporary password with a copy button and a "shown only once" warning.
4. Audit log for USER_CREATED, USER_UPDATED, USER_DEACTIVATED, USER_REASSIGNED,
   PASSWORD_RESET — before/after JSON with passwordHash redacted.

Acceptance: MD creates a member, the member logs in with the temp password and is forced
to change it; deactivating a member with open subtasks is blocked and then succeeds with
a reassignment; integration tests cover both paths.
```

---

## M3 — Jobs

**Prompt**

```
Build module M3: job management. Subtasks come in M4; build job-level only, but design
the publish flow so M4 can plug in.

Deliver:
1. lib/services/jobService.ts:
   - generateJobCode(): "JGE-{YYYY}-{NNNN}", per-calendar-year sequence, generated
     inside the job-insert transaction with a row lock (or a dedicated counter table
     with SELECT ... FOR UPDATE) so 20 concurrent creates produce 20 distinct codes.
     Write a concurrency test that proves it.
   - create (status DRAFT), update (full edit while DRAFT; after publish only title,
     description, customer, priority and attachments), publish, hold, unhold, cancel,
     list with filters (status, priority, department involved, date range, q over
     jobCode/title/partNumber/customerName) and cursor-friendly pagination, getById
     scoped by policy.
   - recomputeJobStatus(jobId): implement SDD section 4.2 exactly. Call it after any
     change to the job or to any of its subtasks. Keep it a pure function over loaded
     rows plus a thin persistence wrapper, and unit-test the pure function.
   - Validation: overallDeadline must be in the future on create; publish requires at
     least one subtask (return VALIDATION_ERROR with a clear message until M4 exists);
     hold/cancel require a reason recorded in the audit log.
2. Routes: GET/POST /api/jobs, GET/PATCH /api/jobs/:id,
   POST /api/jobs/:id/publish, /hold, /unhold, /cancel.
   Member GET is scoped to jobs where they have at least one subtask — enforce it in
   the query, not by filtering after the fetch.
3. Screens:
   - /jobs: list with status chips, priority, deadline with a "due in" relative label,
     progress as completed/total subtasks, search and filters, empty state.
   - /jobs/new: step 1 of a wizard (details) — title, customer, part number, drawing
     number, quantity, priority, overall deadline (date + time picker, IST, any
     minute, with 15-minute suggestions), description. Saves as DRAFT and routes to step 2 (placeholder until M4).
   - /jobs/[id]: header card (code, customer, part, drawing, quantity, priority,
     deadline, derived status badge), MD action menu (edit, hold, cancel, publish),
     and placeholder slots for the subtask timeline and activity feed.
4. Audit log: JOB_CREATED, JOB_UPDATED, JOB_PUBLISHED, JOB_HELD, JOB_CANCELLED,
   JOB_STATUS_RECOMPUTED (only when the value actually changes).

Acceptance: MD creates a draft job, edits it, cannot publish it without subtasks;
a member cannot see it at all; the job-code concurrency test passes.
```

---

## M4 — Subtasks, deadlines and dependencies

**Prompt**

```
Build module M4: subtask assignment, the state machine and dependencies. This is the
core of the product — be rigorous.

Deliver:
1. lib/domain/subtaskStateMachine.ts — a PURE module:
     transition(current: SubtaskStatus, action: SubtaskAction, ctx: TransitionContext)
       => { next: SubtaskStatus } | { error: 'INVALID_TRANSITION' | 'GUARD_FAILED', reason }
   Implement the table in SDD section 4.3 exactly, including guards (dependency
   complete, requiresApproval, actor role, minimum problem description length).
   Unit-test EVERY cell: every legal transition and a representative set of illegal
   ones. No database access in this file.
2. lib/services/subtaskService.ts:
   - create / bulkCreate (used by the job wizard and by templates)
   - updateMeta (MD: title, description, assignee, requiresApproval, reminderLeadMinutes,
     dependsOnId)
   - changeStatus(subtaskId, actor, action, payload) — loads the row, calls the state
     machine, persists, and cascades inside ONE transaction per SDD section 4.4:
       * on COMPLETED: set completedAt; flip BLOCKED dependents whose dependencies are
         now all complete to PENDING; delete PENDING notifications for this subtask;
         recomputeJobStatus; audit
       * on PROBLEM: create the Problem row (M6 refines the MD-side flow)
   - changeDeadline(subtaskId, newDeadline, reason, actor) per SDD section 4.5 —
     DeadlineChange row, delete pending notifications, reset escalationCount to 0,
     audit. (Rescheduling hooks are no-ops until M7; call a
     notificationService.rescheduleForSubtask() stub now so M7 only fills the body.)
   - reassign(subtaskId, newAssigneeId, reason, actor)
   - Validation: deadline must be in the future on create; warn (do not block) if
     deadline > job.overallDeadline and require an override reason; dependsOnId must
     belong to the same job and must not create a cycle — implement and test cycle
     detection; assignee must be active and belong to the subtask's department unless
     the actor explicitly overrides with a reason.
3. Dependency initialisation on publish: any subtask whose dependency is not COMPLETED
   becomes BLOCKED; all others become PENDING.
4. Routes: GET/POST /api/jobs/:id/subtasks, PATCH /api/subtasks/:id,
   POST /api/subtasks/:id/status, /deadline, /reassign.
5. Screens:
   - /jobs/new step 2: subtask builder. "Apply template" prefills 8 rows from the
     Standard CNC Job template with deadlines computed as
     jobDeadline - offsetHoursBeforeDue, then the MD edits inline. Each row: department,
     assignee (filtered to that department), title, deadline (date + time), reminder
     lead hours, depends-on (dropdown of earlier rows), requires-approval toggle.
     Add/remove rows. Inline validation. Step 3: review screen showing the full chain
     with a warning banner for any deadline after the job deadline, then Publish.
   - /jobs/[id]: the real subtask timeline — one band per department in sequenceOrder,
     coloured per SDD section 7.3, showing assignee, deadline, state, and a red overdue
     marker. Clicking a band opens a drawer with history plus MD actions (change
     deadline with reason, reassign, hold, cancel, approve/reject).
6. Audit log: SUBTASK_CREATED, SUBTASK_UPDATED, SUBTASK_STATUS_CHANGED (with from/to),
   SUBTASK_DEADLINE_CHANGED, SUBTASK_REASSIGNED, SUBTASK_BLOCKED, SUBTASK_UNBLOCKED.

Acceptance: MD builds a job from the template in under a minute; publishing sets
PENDING/BLOCKED correctly; completing Planning unblocks Purchase automatically;
attempting a cyclic dependency is rejected; state machine tests are exhaustive.
```

---

## M5 — Member workspace

**Prompt**

```
Build module M5: the member's screens. Optimise ruthlessly for speed — a member on the
shop floor must report status in under 10 seconds on a phone.

Deliver:
1. GET /api/my/tasks returning pre-grouped buckets in ONE query set:
   overdue, dueToday, dueThisWeek, blocked, awaitingApproval, recentlyCompleted
   (last 7 days). Each item carries job code, job title, part number, department,
   title, deadline, status, hoursRemaining (negative when overdue), dependency summary
   { departmentName, status, deadline } and hasOpenProblem.
2. Screen /my-tasks:
   - sticky summary strip: Overdue (n) · Due today (n) · Open problems (n)
   - tabs per bucket with counts; cards sorted by deadline ascending
   - each card: job code + part number, task title, department, deadline with live
     countdown, state badge, and quick actions — Start, Complete, Report problem
   - Complete and Report problem work inline from the list without a page change;
     optimistic update with rollback on error and a toast
   - empty states that read like a human wrote them
3. Screen /tasks/[id] exactly as SDD section 7.2:
   - three large primary buttons (44px+): Start work, Mark completed, Report problem
   - Report problem expands inline: severity chips Low/Medium/High/Blocker, textarea
     with a live counter and the 20-character minimum enforced client and server side
   - predecessor status line when the task is BLOCKED, naming the department, its state
     and its deadline; Start work is disabled with an explanatory tooltip while BLOCKED
   - optional completion note
   - deep-link support: ?action=complete and ?action=problem open the screen with that
     control expanded and focused (used by the emails in M7)
   - comments thread and attachments render here (M10 fills them; leave typed slots)
4. Extension requests: POST /api/subtasks/:id/extension-requests (assignee; requested
   deadline + reason, min 20 chars) and POST /api/extension-requests/:id/decide
   (MD/DEPUTY_MD; approving calls subtaskService.changeDeadline with the reason
   "Extension approved: ..."). Member-side UI: a "Request more time" link on the
   subtask screen with the request's pending/approved/rejected state visible.
5. Read-only cross-department view: a member opening a job they participate in sees all
   its subtasks read-only, with actions only on their own. Confirm this against the
   policy function rather than the UI.
6. PWA basics: manifest, icons, installable, offline fallback page. No offline writes.

Acceptance: on a 380px viewport, a member goes from opening /my-tasks to a completed
task in two taps; a BLOCKED task cannot be started; a 15-character problem description
is rejected by the API, not just the UI.
```

---

## M6 — Problem management

**Prompt**

```
Build module M6: the problem lifecycle and the MD's problem inbox.

Deliver:
1. lib/services/problemService.ts:
   - raise(subtaskId, actor, { description, severity }) — description >= 20 chars from
     settings['problem.min_description_length']; sets the subtask to PROBLEM via the
     state machine; only one OPEN/ACKNOWLEDGED problem per subtask at a time (return
     CONFLICT otherwise).
   - acknowledge(problemId, actor) — timestamps acknowledgedAt.
   - resolve(problemId, actor, { mdActionNote, action }) where action is one of
     RESUME (subtask -> IN_PROGRESS), EXTEND (also calls changeDeadline with the new
     deadline and the note as reason), REASSIGN (calls reassign), CANCEL_SUBTASK, or
     ESCALATE_TO_DEPARTMENT (creates a new subtask in another department, optionally
     making the original depend on it). mdActionNote is mandatory.
   - reject(problemId, actor, note) — subtask returns to IN_PROGRESS, note mandatory.
   - list(filters: status, severity, departmentId, jobId, ageBucket) with a computed
     ageHours and a flag for problems open longer than 24 hours.
2. Routes: GET /api/problems, POST /api/problems/:id/acknowledge, /resolve, /reject.
   MD and DEPUTY_MD only for everything except raising.
3. Screen /problems — the MD's inbox:
   - default sort: severity desc, then age desc; rows older than 24h flagged red
   - columns: age, severity, job code, department, assignee, one-line description,
     current deadline, status
   - filters and a count badge in the main nav
   - row click opens an action drawer showing the full description, the subtask's
     deadline and history, and the five resolution actions as a clear radio choice with
     the fields each one needs, plus a mandatory action note
   - after resolving, the row leaves the inbox and a toast confirms the action taken
4. Job detail integration: an amber problem marker on the department band, with the
   description visible in the drawer.
5. Audit log: PROBLEM_RAISED, PROBLEM_ACKNOWLEDGED, PROBLEM_RESOLVED (with the chosen
   action), PROBLEM_REJECTED.
6. Notification hooks: call notificationService.enqueue for PROBLEM_RAISED (to MD and
   deputies) and PROBLEM_RESOLVED (to the assignee). The service is still a stub until
   M7 — wire the calls now with correct payload types.

Acceptance: member raises a Blocker; it appears at the top of the MD inbox within one
refresh; MD resolves it with EXTEND, which moves the deadline and returns the subtask to
IN_PROGRESS; the whole chain is visible in the audit log; a second problem on the same
subtask is rejected with CONFLICT.
```

---

## M7 — Notification engine (most critical module)

**Prompt**

```
Build module M7: the notification and escalation engine. Implement SDD section 5
precisely. Correctness here matters more than anything else in the product: a missed
overdue mail or a duplicate mail storm both destroy trust in the tool.

Deliver:
1. lib/notifications/dedupe.ts — pure dedupe-key builders, exactly as SDD 5.1:
     subtask:{id}:ASSIGNED:{userId}
     subtask:{id}:REMINDER:{deadlineEpochMs}
     subtask:{id}:OVERDUE_MEMBER:{n}
     subtask:{id}:OVERDUE_MD:{n}:{userId}
     problem:{id}:RAISED:{userId}
     digest:{userId}:{yyyy-mm-dd}
   Unit-test them, including that changing a deadline changes the reminder key.
2. lib/notifications/workingHours.ts — nextWorkingSlot(date) using working_hours,
   working_days and the Holiday table, all in Asia/Kolkata. Unit-test: inside hours
   (unchanged), after hours (next morning), before hours (same morning), Sunday
   (Monday), a holiday, a holiday followed by Sunday, 23:59 and 00:01 edges.
3. lib/notifications/notificationService.ts:
   - enqueue(input) using INSERT ... ON CONFLICT (dedupeKey) DO NOTHING
   - scheduleForSubtask(subtask): ASSIGNED at now, REMINDER at
     deadline - reminderLeadMinutes (skip if already in the past)
   - rescheduleForSubtask(subtask): delete PENDING rows of types REMINDER and OVERDUE_*
     for the subtask, then schedule again (fills the M4 stub)
   - cancelForSubtask(subtaskId): delete PENDING rows (used on complete/cancel)
   - markRead / list for the in-app inbox
4. lib/notifications/channels/*: the NotificationChannel interface from SDD 5.5, with
   EmailChannel (Nodemailer, retry-aware, real Message-ID captured) and InAppChannel
   (no-op). A registry keyed by NotifChannel so adding WhatsApp later touches nothing
   else.
5. Email templates in lib/notifications/templates/ using React Email, each with a
   plain-text fallback and a typed payload: SUBTASK_ASSIGNED, DEADLINE_REMINDER,
   OVERDUE_MEMBER, OVERDUE_MD, PROBLEM_RAISED, PROBLEM_RESOLVED, DEADLINE_CHANGED,
   EXTENSION_REQUESTED, APPROVAL_REQUIRED, JOB_COMPLETED, DAILY_DIGEST_MD.
   Use the exact wording and table layout in SDD 5.4 for OVERDUE_MD and OVERDUE_MEMBER.
   Every mail includes a deep link to /tasks/{id}?action=... (member) or
   /jobs/{id} / /problems (MD), all built from APP_BASE_URL. Formal register, "Dear Sir"
   for the MD, all times shown in IST with the format "13 Sep 2026, 6:00 PM".
   Add a dev-only route /api/dev/preview-email?type=... that renders each template with
   sample data, available only when NODE_ENV !== 'production'.
6. worker/index.ts — the worker process:
   - sweeper every SCHEDULER_INTERVAL_MINUTES (default 5), implementing STEP 1 and
     STEP 2 of SDD 5.2 exactly, including FOR UPDATE SKIP LOCKED, the 200-row batch,
     backoff of 2/10/30 minutes with FAILED after 5 attempts, and working-hour shifting
     applied ONLY to SUBTASK_ASSIGNED, DEADLINE_REMINDER and DAILY_DIGEST_MD
   - STEP 2 must exclude subtasks whose status is PROBLEM, COMPLETED, CANCELLED or
     ON_HOLD, and jobs that are ON_HOLD or CANCELLED, and must respect
     escalation.max_count and escalation.interval_minutes; each escalation increments
     escalationCount and sets lastEscalatedAt, sends to the assignee AND to every
     MD/DEPUTY_MD, recomputes job status, and writes an audit row
   - daily digest at settings['digest.time'] IST: overdue subtasks, due today, and open
     problems with their age, to MD and deputies
   - heartbeat: write settings['scheduler.heartbeat'] = now() every pass
   - graceful SIGTERM shutdown that finishes the in-flight batch
7. GET /api/health returning { ok, dbOk, redisOk, schedulerHeartbeatAgeSeconds,
   pendingNotifications, failedNotifications }, and degraded when the heartbeat is
   older than 20 minutes.
8. In-app notification inbox: GET /api/notifications, POST /api/notifications/:id/read,
   a bell with an unread count in the header, and a /notifications page.
9. Tests — treat these as the definition of done. Use fake timers and a test Postgres:
   - publish a job -> exactly one ASSIGNED and one REMINDER row per subtask, with
     scheduledFor == deadline - lead
   - clock at deadline - 6h -> reminder sent once; run the sweeper five more times ->
     still exactly one email
   - clock at deadline + 1m -> one OVERDUE_MEMBER and one OVERDUE_MD per MD; at +4h ->
     escalation 2; after max_count -> no further rows ever
   - subtask in PROBLEM -> no overdue mails at all
   - extend the deadline -> the old pending reminder is gone, a new one exists,
     escalationCount is 0, and the old dedupe key can never fire
   - complete the subtask before the deadline -> no reminder, no overdue
   - kill the sweeper mid-batch and restart -> no duplicate emails
   - reminder scheduled for 2 AM -> shifted to 9 AM; overdue at 2 AM -> sent at 2 AM

Acceptance: all of the above tests pass; Mailpit shows correctly rendered mails for
every template; /api/health reports a fresh heartbeat.
```

---

## M8 — Dashboards, scorecards and exports

**Prompt**

```
Build module M8: analytics for the MD.

Deliver:
1. GET /api/dashboard/md returning, for a date range defaulting to the current month:
   activeJobs, atRiskJobs, delayedJobs, completedThisMonth, overdueSubtasks,
   openProblems (with a count older than 24h), onTimeCompletionPercent,
   averageDelayHours, plus a 30-day series of completed-on-time vs completed-late.
   One efficient query set — no N+1.
2. GET /api/dashboard/department/:id: onTimePercent, averageDelayHours,
   problemsRaised, problemsWhereThisDepartmentWasTheRootCause (defined as: an open or
   resolved problem on a subtask that blocked at least one dependent subtask),
   subtasksCompleted, currentOpen. Include a comparison across all eight departments
   for the same range.
3. Screen /dashboard (MD landing):
   - six KPI tiles, each clicking through to a filtered list
   - "Needs your attention": open problems sorted by severity and age, then overdue
     subtasks — the two things the MD must act on today, above the fold
   - at-risk and delayed jobs table with the blocking department named
   - a simple on-time trend chart (Recharts)
   - date-range selector; everything mobile-responsive with tiles stacking
4. Screen /reports:
   - department scorecard table with sortable columns and a bar chart
   - job report: filters, and per job the full subtask chain with planned vs actual and
     delay in hours
   - exports: Excel (exceljs) for any list, PDF for a single job report — header with
     the company name and job code, the subtask table, problems and their resolutions,
     and a footer with the generation timestamp in IST
5. GET /api/reports/export?type=jobs|subtasks|problems|job-report&format=xlsx|pdf,
   streamed, MD/DEPUTY_MD/ADMIN only.
6. Define "on time" once, in lib/domain/metrics.ts: completedAt <= deadline, using the
   deadline in force at completion; cancelled subtasks excluded; extended deadlines
   counted against the CURRENT deadline, with a separate extensionCount metric so
   extensions cannot hide a delay. Unit-test the definitions.

Acceptance: the dashboard loads in under 2 s with 500 jobs of seeded data; a member
cannot reach any dashboard endpoint; the Excel and PDF exports open correctly.
```

---

## M9 — Governance: settings, calendar, audit

**Prompt**

```
Build module M9: administrative governance.

Deliver:
1. GET/PUT /api/settings (MD, ADMIN) with a typed, Zod-validated schema per key from
   SDD 3.4. A settings cache with a 60-second TTL, invalidated on write, used
   everywhere instead of raw table reads. Changing a setting never retroactively
   rewrites already-scheduled notifications — document that in the UI.
2. Screen /settings, grouped sections:
   - Reminders: default lead time (hours), escalation interval, max escalations
   - Working hours: start, end, working days, suppress-outside-hours toggle with a note
     that overdue mails ignore it
   - Notifications: MD extra recipients, from address, SMTP host/port/user (password
     write-only, never returned by the API), and a "Send test email" button
   - Problems: minimum description length
   - Digest: time of day
   Show a live preview line: "A task due 13 Sep 6:00 PM will remind at 13 Sep 12:00 PM".
3. Holiday calendar: GET/POST/DELETE /api/holidays, a month-grid UI, bulk add, and a CSV
   import for the annual list.
4. Audit log viewer /audit (MD, ADMIN): filters by actor, entity type, entity id,
   action, date range; a readable before/after diff; pagination; CSV export. The audit
   log is append-only — no update or delete endpoints exist.
5. Job template management /settings/templates: CRUD on JobTemplate and
   JobTemplateItem with a visual dependency preview, and a warning when editing a
   template that existing jobs are unaffected.
6. Startup config validation: on boot, validate every required env var and every
   setting; fail fast with a clear message listing what is missing.

Acceptance: changing the default reminder lead time to 4 hours affects newly published
subtasks only; adding a holiday shifts a reminder that would have landed on it; the
audit viewer shows a full trace of one job from creation to completion.
```

---

## M10 — Collaboration: comments and attachments

**Prompt**

```
Build module M10: comments and attachments.

Deliver:
1. GET/POST /api/subtasks/:id/comments — scoped so a member can comment on subtasks of
   jobs they participate in, MD anywhere. Body 1..2000 chars, plain text, escaped on
   render (never dangerouslySetInnerHTML). @mention of a user by name creates an in-app
   notification for that user.
2. Attachments: POST /api/attachments/presign returns a presigned PUT for an
   S3-compatible bucket; POST /api/attachments registers the uploaded object.
   Allow-list pdf, png, jpg, jpeg, dxf, dwg, step, stp, xlsx, docx; 25 MB maximum;
   verify the declared content type against the extension and reject a mismatch;
   generate the storage key server-side as
   {jobId}/{subtaskId}/{cuid}.{ext} — never trust a client-supplied path.
   Downloads only via short-lived presigned GET URLs from
   GET /api/attachments/:id/url.
3. UI: an activity feed on /jobs/[id] merging comments, status changes, deadline
   changes and problem events into one chronological timeline with actor avatars and
   IST timestamps. On /tasks/[id], a comment composer and an attachment list with
   thumbnails for images, an icon plus size for other types, and a drag-and-drop
   dropzone with an upload progress bar.
4. Attachments on the job itself (customer drawing, PO) shown in the job header card.
5. Audit log: COMMENT_ADDED, ATTACHMENT_UPLOADED, ATTACHMENT_DELETED (soft delete only).

Acceptance: a 30 MB file is rejected client and server side; a .exe renamed to .pdf is
rejected; an attachment URL expires; the activity feed reads as a coherent story of the
job.
```

---

## M11 — Hardening, tests and deployment

**Prompt**

```
Build module M11: make it production-ready. No new features.

Deliver:
1. Playwright end-to-end suite, seeded fresh per run:
   a. MD logs in, creates a job from the template, publishes it
   b. the Planning member sees it in My Tasks and marks it completed
   c. Purchase, previously BLOCKED, becomes actionable
   d. the Purchase member reports a Blocker problem
   e. the MD sees it in the inbox and resolves it with EXTEND
   f. the member sees the new deadline and completes the task
   g. the MD dashboard reflects the on-time percentage correctly
   Plus a time-travelled spec that asserts the reminder and both overdue mails were
   generated with the right recipients, subjects and dedupe keys.
2. Performance: seed 500 jobs / 4000 subtasks; assert p95 under 500 ms for
   /api/jobs, /api/my/tasks, /api/dashboard/md and /api/problems. Add any missing
   indexes and document each one.
3. Security pass: run pnpm audit and fix; verify CSP, HSTS and the other headers from
   SDD section 8; confirm every route calls requireAuth and can(); write a negative
   test per role per sensitive endpoint; confirm SMTP and S3 credentials never appear
   in any API response or log line; scrub request bodies in error logging.
4. Observability: pino structured logs with a request id; Sentry for server and client
   errors; a scheduler alert when the heartbeat exceeds 20 minutes or failed
   notifications exceed 5 in an hour.
5. Deployment: production docker-compose per SDD 10.2 (app, worker, db, redis, caddy
   with automatic TLS), a deploy script running prisma migrate deploy then a rolling
   restart, and a nightly pg_dump-to-object-storage job with 30-day retention plus a
   documented and tested restore procedure.
6. Docs in /docs:
   - RUNBOOK.md: deploy, rollback, restore, "mails are not going out" triage,
     "scheduler is dead" triage, how to resend a notification
   - ADMIN_GUIDE.md: MD's guide — create a job, read the dashboard, handle a problem,
     manage users, change reminder settings
   - MEMBER_GUIDE.md: one page with screenshots — find my task, complete it, report a
     problem
   - GO_LIVE_CHECKLIST.md: SDD section 10.5 as a tickable list, with SPF/DKIM/DMARC
     verification called out as blocking
7. Seed a realistic demo dataset (10 jobs across all states, including two overdue and
   one with an open problem) behind a script, for training and for the MD demo.

Acceptance: `docker compose -f docker-compose.prod.yml up -d` on a clean VPS gives a
working HTTPS deployment; the e2e suite passes in CI; a restore from last night's
backup has actually been performed once and the result recorded in RUNBOOK.md.
```

---

## Appendix A — Suggested build order and effort

| Order | Module | Effort | Blocks |
|---|---|---|---|
| 1 | M0 Foundation | 1–2 days | everything |
| 2 | M1 Auth & RBAC | 2 days | everything |
| 3 | M2 Directory | 1–2 days | M4 |
| 4 | M3 Jobs | 2 days | M4 |
| 5 | M4 Subtasks | 3–4 days | M5, M6, M7 |
| 6 | M5 Member workspace | 2–3 days | M7 tests |
| 7 | M6 Problems | 2 days | M7 |
| 8 | **M7 Notifications** | **3–4 days** | the value proposition |
| 9 | M8 Analytics | 2–3 days | — |
| 10 | M9 Governance | 2 days | — |
| 11 | M10 Collaboration | 2 days | — |
| 12 | M11 Hardening | 3 days | go-live |

Roughly 5–7 weeks for one developer working with an AI agent, or 3–4 weeks for two.

**Thin-slice alternative:** if the MD wants something usable in two weeks, build
M0 → M1 → M3 (jobs without templates) → M4 (no dependencies, no approval) → M5
(My Tasks and status update only) → M7 (assignment, reminder, overdue escalation only).
That is the complete core loop of the original brief. Everything else is an upgrade on
a working product.

---

## Appendix B — Prompt hygiene that saves rework

- Give the agent the SDD, not a paraphrase. Ambiguity is where the deadline bugs come from.
- Never accept "notifications work" without the time-travel tests. Off-by-one-timezone
  bugs are invisible until a real deadline is missed.
- Ask for the state machine as a pure function first, before any UI. If it is embedded in
  a route handler it will be wrong and unfixable.
- When the agent proposes a shortcut on the dedupe key or the audit log, say no. Those
  two are the product's credibility.
- After each module, ask: "what did you defer, and what would break in production?"
  Keep the answers in a `docs/DEFERRED.md`.
