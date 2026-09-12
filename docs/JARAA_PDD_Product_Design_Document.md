# Product Design Document (PDD)
## Jaraa Task & Accountability System (JTAS)
**Client:** Jaraa Global Engineering Pvt Ltd
**Document version:** 1.0
**Date:** 12 September 2026
**Owner:** Product / Engineering
**Status:** Draft for MD approval

---

## 1. Purpose of this document

The PDD defines *what* the product is, who uses it, and what it must do. It is the
contract between the MD and the build team. The SDD (separate document) defines *how*
it is built.

---

## 2. Problem statement

Jaraa Global Engineering runs CNC job orders that pass through eight functions:
Planning, Purchase, Production, HR, Accounts, Store, Quality and Dispatch. Today the
MD tracks progress through phone calls, WhatsApp messages and verbal updates. The
consequences:

- The MD has no single view of where a job actually stands.
- Delays surface only after the customer complains.
- Problems (material short, tool broken, drawing mismatch) reach the MD late, when the
  cost of recovery is highest.
- There is no record of who was told what, and when, so accountability is disputed.

## 3. Product vision

One web application where the MD issues a CNC job, breaks it into department
subtasks with deadlines, and the system chases everybody automatically. Nobody has to
remember a deadline, and nothing silently slips. Every problem is raised in writing,
lands on the MD's desk immediately, and is closed with a recorded decision.

**One-line pitch:** *Assign it once, and the system does the following up.*

---

## 4. Users and personas

| Persona | Role in system | Count | Primary need |
|---|---|---|---|
| **Managing Director** | `MD` (super admin) | 1 | See everything, decide fast, prove accountability |
| **Department Member** | `MEMBER` | 8–20 | Know exactly what is due today and report status in 10 seconds |
| **Deputy / Coordinator** | `DEPUTY_MD` (optional) | 0–2 | Act for the MD when he is travelling |
| **System Admin** | `ADMIN` | 1 | Create users, reset passwords, maintain holiday calendar |

The eight departments are seeded as: Planning, Purchase, Store, Production, Quality,
Dispatch, Accounts, HR.

> **Improvement added (I-01):** a `DEPUTY_MD` role. With a single-MD design, the whole
> factory stalls whenever the MD is on a flight or in a customer meeting. The deputy
> can approve problems and extend deadlines; every deputy action is stamped
> "on behalf of MD" in the audit log.

---

## 5. Scope

### 5.1 In scope (Phase 1)
1. Separate login per user, role-based screens, no public self-signup.
2. MD creates a **Job** (CNC product order) with an overall deadline.
3. MD creates **Subtasks** under the job, one or more per department, each with its
   own assignee and its own deadline.
4. **Reminder** notification a configurable lead time before each subtask deadline
   (default 6 hours; the 6 PM / 12 PM example is exactly this default).
5. Member marks a subtask **Completed**, or selects **Problem** and describes it in a
   free-text box.
6. **Overdue escalation:** if a deadline passes and the subtask is neither completed
   nor flagged as a problem, an automated email goes to
   - the MD: *"<Member> has not completed <subtask> of <job>, due <time>"*
   - the member: *"Please complete the work — <subtask> of <job> was due <time>"*
7. MD **Problem inbox**: acknowledge, add an action note, extend the deadline,
   reassign, or cancel.
8. Job and department dashboards, overdue list, on-time percentage.
9. Full audit trail of every status change and deadline change.
10. Mobile-friendly responsive UI (usable on a phone on the shop floor).

### 5.2 Out of scope (Phase 1)
- ERP / Tally / accounting integration.
- Machine-level OEE or CNC controller data capture.
- Customer-facing portal.
- Payroll, attendance, leave (HR here means HR *tasks* on a job, not HR software).
- Inventory quantity management (Store here means Store *tasks*, not stock ledger).
- Native Android/iOS apps (PWA install is offered instead).

---

## 6. Core concepts

```
Job (one CNC order)
 └── Subtask (one department's piece of work)   ── has deadline, assignee, status
      ├── Problem (raised by member, resolved by MD)
      ├── Comments (thread)
      └── Attachments (drawing, PO, inspection report)
```

### 6.1 Default CNC job flow

Subtasks may depend on each other. The seeded template encodes the real shop
sequence, and the MD can override any of it:

```
Planning ──► Purchase ──► Store ──► Production ──► Quality ──► Dispatch ──► Accounts (invoice)
   │
   └──► HR (manpower / shift allocation, runs in parallel)
```

> **Improvement added (I-02): subtask dependencies.** A Production subtask that starts
> before material is in the Store is a fake deadline. A dependent subtask sits in
> `BLOCKED` and its clock is not enforced until its predecessor is completed. It also
> means the MD instantly sees the *root* delay instead of six red rows.

> **Improvement added (I-03): job templates.** Creating eight subtasks by hand for
> every order will not survive contact with a busy MD. A template stores the eight
> standard subtasks with day/hour offsets from the job deadline, so a new job is
> "pick template → set due date → review → publish" in under a minute.

---

## 7. Functional requirements

### 7.1 Authentication and access
| ID | Requirement | Priority |
|---|---|---|
| FR-01 | Email + password login, separate credentials per user. | Must |
| FR-02 | No self-registration. MD/Admin creates users and assigns department + role. | Must |
| FR-03 | Forced password change on first login; password reset by Admin. | Must |
| FR-04 | Session expiry after 12 hours idle; "remember this device" for 30 days. | Should |
| FR-05 | A member sees only jobs where he has at least one subtask. MD/Deputy see all. | Must |
| FR-06 | Account lockout for 15 minutes after 5 failed attempts. | Should |

### 7.2 Job management (MD)
| ID | Requirement | Priority |
|---|---|---|
| FR-10 | Create a job with: auto job code (`JGE-2026-0001`), title, customer, part number, drawing number, quantity, priority, overall deadline, description, attachments. | Must |
| FR-11 | Create a job from a template, auto-generating department subtasks with offset deadlines. | Should |
| FR-12 | Edit job while in `DRAFT`; after `PUBLISHED`, changes to deadlines are logged and notified. | Must |
| FR-13 | Job status derived automatically: `DRAFT`, `IN_PROGRESS`, `AT_RISK`, `DELAYED`, `COMPLETED`, `CANCELLED`. | Must |
| FR-14 | Cancel or put a job on hold; all its subtask timers pause. | Should |

### 7.3 Subtask assignment
| ID | Requirement | Priority |
|---|---|---|
| FR-20 | One subtask = one department + one assignee + one deadline (date **and** time). | Must |
| FR-21 | Per-subtask reminder lead time in hours, default from settings (6 h). | Must |
| FR-22 | Optional dependency on another subtask of the same job. | Should |
| FR-23 | Subtask deadline cannot exceed the job's overall deadline; system warns, MD may override with a reason. | Should |
| FR-24 | MD can reassign a subtask; both old and new assignee are notified. | Must |
| FR-25 | Optional `requires_approval` flag: member's "Completed" becomes `AWAITING_APPROVAL` until MD accepts. | Could |

> **Improvement added (I-04): optional completion approval.** Self-declared
> "completed" is the weakest link in this kind of system. The flag is off by default
> so it does not create bureaucracy, and is switched on for the subtasks that matter
> (Quality clearance, Dispatch).

### 7.4 Member workspace
| ID | Requirement | Priority |
|---|---|---|
| FR-30 | "My Tasks" screen grouped: Overdue, Due today, Due this week, Blocked, Done. | Must |
| FR-31 | Mark **In Progress**, **Completed**, or **Problem**. | Must |
| FR-32 | Raising a problem requires a description of at least 20 characters and a severity (Low / Medium / High / Blocker). | Must |
| FR-33 | Member may request a deadline extension with a reason; only MD can grant it. | Should |
| FR-34 | Member can comment and attach files on his own subtasks. | Should |
| FR-35 | Member cannot edit his own deadline, cannot delete a subtask, cannot un-complete after MD approval. | Must |

### 7.5 Problem handling
| ID | Requirement | Priority |
|---|---|---|
| FR-40 | On problem raise: instant email + in-app notification to MD (and Deputy). | Must |
| FR-41 | MD problem inbox with age, severity, job, department. | Must |
| FR-42 | MD actions: Acknowledge, add action note, Extend deadline, Reassign, Escalate to another department, Resolve, Cancel subtask. | Must |
| FR-43 | Member is notified of the MD's decision; subtask returns to `IN_PROGRESS` on resolution. | Must |
| FR-44 | A subtask in `PROBLEM` does not fire overdue mails to the member, but fires a daily "unresolved problem" nudge to the MD. | Should |

> **Improvement added (I-05).** In the original brief, a member who has reported a
> genuine blocker would keep receiving "please complete the work" mails — which
> teaches everyone to ignore the mails. Once a problem is on record, the pressure
> correctly moves to the MD.

### 7.6 Notifications
| ID | Requirement | Priority |
|---|---|---|
| FR-50 | `SUBTASK_ASSIGNED` → member, immediately on publish. | Must |
| FR-51 | `DEADLINE_REMINDER` → member, at `deadline − lead_time`. | Must |
| FR-52 | `OVERDUE_MEMBER` → member: "Please complete the work". | Must |
| FR-53 | `OVERDUE_MD` → MD: "<Member> did not complete...". | Must |
| FR-54 | Repeat escalation every 4 hours after the deadline, maximum 3 repeats, then stop and mark `ESCALATED`. | Should |
| FR-55 | `PROBLEM_RAISED` → MD; `PROBLEM_RESOLVED` → member; `DEADLINE_CHANGED` → assignee. | Must |
| FR-56 | Daily 9:00 AM IST digest to MD: overdue, due today, open problems. | Should |
| FR-57 | Reminders are suppressed outside working hours and on holidays, and delivered at the next working-hour slot; **overdue mails are never suppressed**. | Should |
| FR-58 | Every notification is recorded once and only once, even if the scheduler restarts. | Must |
| FR-59 | Optional WhatsApp/SMS channel for `OVERDUE_*` and `PROBLEM_RAISED`. | Could |

> **Improvement added (I-06): working-hours-aware reminders and a notification ledger.**
> A 2 AM reminder is noise. A duplicate mail storm after a server restart destroys
> trust in the tool. Both are prevented by design, not by luck.

> **Improvement added (I-07): WhatsApp/SMS option.** On an Indian shop floor, email
> is checked less often than WhatsApp. The channel is pluggable so it can be enabled
> later without touching the rest of the system.

### 7.7 Dashboards and reports
| ID | Requirement | Priority |
|---|---|---|
| FR-60 | MD dashboard: active jobs, at-risk jobs, overdue subtasks, open problems, on-time % this month. | Must |
| FR-61 | Job detail timeline showing every subtask, its state and its delay in hours. | Must |
| FR-62 | Department scorecard: on-time %, average delay, problems raised, problems caused. | Should |
| FR-63 | Export any list to Excel; export a job report to PDF. | Should |
| FR-64 | Date-range filters and full-text search on job code, part number, customer. | Should |

### 7.8 Administration
| ID | Requirement | Priority |
|---|---|---|
| FR-70 | User CRUD, activate/deactivate (never hard-delete). | Must |
| FR-71 | Settings: default reminder lead time, escalation interval and count, working hours, digest time, SMTP details. | Must |
| FR-72 | Holiday calendar maintenance. | Should |
| FR-73 | Immutable audit log, filterable by user, entity and date. | Must |
| FR-74 | Job template management. | Should |

---

## 8. Subtask state machine

```
                    ┌───────────── BLOCKED ◄──── (dependency not complete)
                    │                  │
                    ▼                  ▼
PENDING ──► IN_PROGRESS ──► COMPLETED ──► (job closes)
   │             │   ▲            ▲
   │             ▼   │            │  MD approves
   │         PROBLEM─┘      AWAITING_APPROVAL
   │             │                 │  MD rejects
   │             │                 └──► IN_PROGRESS
   ▼             ▼
CANCELLED    ON_HOLD
```

`OVERDUE` is **not** a state. It is a derived condition (`now > deadline AND status
NOT IN (COMPLETED, CANCELLED)`), so a subtask can be simultaneously
`IN_PROGRESS` and overdue. This keeps the history honest.

> **Improvement added (I-08).** Treating "overdue" as a status would erase the
> information about what the person was actually doing, and would need a reverse
> transition when the deadline is extended.

---

## 9. Non-functional requirements

| Area | Requirement |
|---|---|
| Users | 25 named users, 15 concurrent. Design headroom to 100. |
| Volume | ~50 jobs/month, ~400 subtasks/month, 3 years online = ~15k subtasks. Trivial for Postgres. |
| Performance | Page interactive < 2 s on 4G; list APIs < 500 ms p95. |
| Availability | 99% during 8 AM–10 PM IST. Scheduler must survive restart without double-sending. |
| Timezone | All timestamps stored in UTC, displayed in Asia/Kolkata. |
| Security | Bcrypt (cost 12) passwords, HTTPS only, JWT with refresh rotation, RBAC enforced server-side on every endpoint, file upload type and size validation, rate limiting on auth. |
| Auditability | No hard deletes on jobs, subtasks, problems or users. |
| Backup | Nightly automated DB backup, 30-day retention, documented restore test. |
| Accessibility | Keyboard navigable, minimum 14 px body text, contrast ≥ 4.5:1. |
| Language | English UI in Phase 1; strings externalised for a later Tamil/Hindi pass. |

---

## 10. Success metrics

| Metric | Baseline | Target at 90 days |
|---|---|---|
| Jobs with all subtasks updated in-app | 0% | > 90% |
| Subtasks completed on or before deadline | unknown | > 80% |
| Median time from problem raised to MD action | hours/days | < 2 hours |
| MD phone calls per day chasing status | high | halved (self-reported) |
| Overdue mails per member per week | n/a | trending down month on month |

---

## 11. Release plan

| Phase | Contents | Estimate |
|---|---|---|
| **P1 — Core loop** | Auth, users, departments, jobs, subtasks, member status update, problem raise, MD inbox, email reminder + overdue escalation, basic dashboards, audit log | 4–5 weeks |
| **P2 — Hardening** | Templates, dependencies, working-hours calendar, department scorecards, Excel/PDF export, daily digest, attachments | 2–3 weeks |
| **P3 — Reach** | WhatsApp/SMS, PWA install + push, approval workflow, Deputy MD, local-language strings | 2–3 weeks |

---

## 12. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Members bypass the tool and keep using WhatsApp | Phase 1 must be faster than typing a WhatsApp message: two taps to complete. MD publicly stops accepting verbal status. |
| Mail lands in spam and nobody sees it | Use a real SMTP provider with SPF/DKIM on the jaraa domain; in-app notification as backup; WhatsApp in P3. |
| MD does not clear the problem inbox, and the tool becomes a graveyard | Daily digest with problem age; problems older than 24 h flagged red on the dashboard. |
| Deadlines set unrealistically, everything red, alarm fatigue | Extension-request flow plus department scorecards make bad planning visible rather than hidden. |
| One person leaves and his subtasks are orphaned | Deactivating a user forces reassignment of his open subtasks. |
| Scheduler silently dies, no mails go out | Scheduler writes a heartbeat; a missed heartbeat alerts the admin. |

---

## 13. Open questions for the MD

1. Company email domain and SMTP provider (Google Workspace, Zoho, Microsoft 365)?
2. Working hours and weekly off — 9:00 AM to 6:00 PM, Sunday off? Second Saturday?
3. Should a member see other departments' subtasks on the same job (read-only)? Recommended: yes, it reduces phone calls.
4. Exact overdue mail wording the MD wants, and the signature block.
5. Hosting preference: cloud (recommended) or an in-office server?
6. Is a Deputy MD wanted from day one, and who?
7. Are Accounts and HR subtasks needed on every job, or only on some?
