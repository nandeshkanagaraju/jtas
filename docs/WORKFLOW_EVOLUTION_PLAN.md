# Manufacturing workflow proposal

Status: planning draft, October 22, 2026. No application logic, permissions,
notification channels or database records have been changed for this proposal.

Mobile delivery decision: the owner selected an installable web app pilot first,
with Google Play registration considered only after successful testing. See
INSTALLABLE_APP_PILOT.md. Existing email/Telegram delivery remains until a tested
replacement is implemented; installation alone does not provide Web Push.

## Outcome

One job record should explain what was ordered, which drawing is current, what
material is available, who is responsible now, what each department promised,
what is blocking the next operation, and what evidence supports completion.
Notifications point back to that record. Receiving a message is not completing,
accepting or approving work.

## Existing foundation and gaps

- Job creation/publishing currently belongs to MD/Deputy MD, not Planning members
  (`src/lib/auth/policy.ts`). Planning publishing needs an explicit capability.
- Sequential tasks, department-owned deadlines, dependency handoffs and a 24-hour
  commitment window already exist. The current window is 24 elapsed hours even
  over nights/holidays (`src/lib/domain/commitment.ts`). Keep this unless changed
  deliberately; working-hour notification delivery is a separate rule.
- Each task has one assignee and at most one predecessor. A predecessor can have
  several successors, but an operation cannot currently require multiple inputs.
- A deadline commitment alerts immediate successor assignees, not every affected
  department (`notifyCommitmentMade`). Problem alerts currently target command;
  downstream delay visibility and access need expanding together.
- Existing job/task uploads, comments, audit logs, notification deduplication,
  retrying and Telegram account links are useful foundations.
- Attachments are generic: there are no drawing revision/release records or typed
  material receipt, inspection, tooling, machine downtime or dispatch records.
- Telegram currently mirrors selected email events. Email is not replaced by
  Telegram, so adding channels alone would preserve duplication/noise.
- The installable website has an offline page/service worker, but no Web Push
  subscription or push-event implementation.

## Reading of the supplied photos

IMG_0868: PPC (Production Planning and Control) starts from a customer/monthly
schedule and part/material specifications. Purchase places an order with a material
lead time and expected receipt date. Stores unloads received stock and informs
Quality; only inspected/approved stock proceeds to Production. Handwritten example
part numbers, quantities and weight units need confirmation before becoming data.

IMG_0869: cutting -> CNC operations -> WIP -> quality -> finished goods; coating
is mentioned but its position relative to inspection/dispatch is ambiguous.

IMG_0870: production breakdown -> maintenance -> spare-part requisition -> Purchase.

IMG_0871: customer material -> stores -> incoming quality verification -> stores
issue to production -> VMC operation 1 and operation 2 -> WIP -> quality -> FG.

IMG_0863 is a phone display photo, with no manufacturing workflow information.

## Proposed workflow

1. MD or an authorized Planning publisher creates a job: customer, part, quantity,
   customer delivery commitment, material source, route, responsible departments,
   accountable people and drawing requirements. Review and publish atomically.
   Keep the customer/monthly schedule separate from each job/batch release. A
   schedule can generate multiple jobs; its demand must not be confused with one
   purchase quantity. Show ordered date, supplier lead time, expected arrival,
   actual arrival and customer delivery date as separate values. Derive a suggested
   latest order date from required material availability and lead time, then have
   Purchase confirm the supplier promise. Flag infeasible delivery plans early.
2. Assigned people can see the full authorized job route immediately, including
   future work, material ETA and released drawings. Department visibility should
   include relevant authorized colleagues, with one accountable task owner.
3. Planning releases a drawing revision. Purchase and Production are notified;
   Production can acknowledge the revision and prepare tools, fixtures, programs
   and machine availability before material arrives. A revision supersedes rather
   than deletes the old drawing, and invalidates affected acknowledgments.
4. For company-purchased material, Purchase records supplier, PO, material lines,
   ordered quantity/unit and promised arrival. For customer-supplied material,
   track the customer's expected receipt/challan instead of inventing a purchase.
   These two source names are provisional until the owner confirms them.
5. Stores records each physical receipt. Incoming Quality records accepted,
   rejected and inspection-pending quantities and reasons. Rejected stock is
   quarantined; it cannot be issued to machining as available stock.
6. Purchase delivery can close when the agreed receipt condition is satisfied.
   This does not mean machining is ready. Stores/Quality still own their gates.
   A short delivery or unresolved replacement remains an outstanding obligation.
7. Stores issues approved material. Machining becomes ready only when its required
   material, released drawing, tooling/preparation and preceding operations are
   ready. Its assignee then receives 24 hours to commit a finish date. Early
   estimates remain distinguishable from this accountable commitment.
8. Repeat handoffs through actual machining operations, final inspection, optional
   outside processing/coating, any required return inspection, FG and dispatch.
   Routes are configurable per job. WIP/FG are stock states, not artificial people
   or departments that must promise dates.
9. Dispatch records quantity, delivery challan/invoice references, packing and
   transport/tracking evidence. Partial dispatches remain open for their balance.
   Operational completion and accounts/payment completion should be distinct.

## October 22 / October 28 example

On October 22 Purchase commits an October 28 arrival date. All authorized job
participants see it. Drawing release independently starts preparation work; do
not block tooling procurement behind raw-material arrival.

On October 28 a Stores receipt confirms arrival, not the calendar or an email.
Incoming Quality releases accepted material; Stores issues it. The next actionable
operation's 24-hour commitment window begins when its own readiness gates clear.

If material does not arrive, the system marks the milestone overdue and asks
Purchase for a structured delay update. It immediately alerts MD and affected
owners that the date was missed, even before Purchase supplies the explanation.
It must never invent a reason or silently move the original promise.

A delay update records reason, responsible party, affected quantity/operations,
revised ETA, recovery action and evidence. Proposed ETA, original promise and
MD-approved revised commitment remain separate fields/history. Other departments
can continue preparation; blocked machining does not receive a fake execution date.

## Evidence and controls

| Stage | Required structured evidence |
| --- | --- |
| Planning | Drawing number/revision, release, route and recipient acknowledgment |
| Purchase | Supplier/customer source, material grade/specification, ordered quantity/unit, PO/challan, ETA, bill references |
| Receipt | Receipt date, batch/lot, received quantity/unit, shortage and receipt document |
| Incoming quality | Inspected, accepted, rejected and pending quantities, reason, certificate/report |
| Stores issue | Approved lot, quantity issued and receiving operation/person |
| Production | Operation, machine, input/output quantity, good/rejected/rework quantity, scrap reason, evidence |
| Quality | Inspection result, accepted/rejected/rework quantities and release |
| Outside processing | Vendor, sent/returned quantities, expected return, challan and return inspection |
| Dispatch | Released FG quantity, shipped/balance quantity, invoice/challan and transport evidence |

Validate quantities per lot and unit: accepted + rejected + pending = received;
issued cannot exceed released availability. Do not add kilograms and pieces.
Model partial receipts, lot splits and rework transfers without double-counting.
Completion gates require relevant evidence; uploading an arbitrary file is not
enough. Corrections retain their audit trail. Financial evidence is visible only
to authorized roles; drawings are shared more widely within the job.

Machine breakdowns are separate incidents linked to affected operations/jobs.
Maintenance can request spares from Purchase without creating a cycle in the job
route. Track downtime start/end, impact, recovery ETA and resolution evidence.

## Notification policy

Recommended initial rollout: portal inbox + optional Telegram alerts, with email
for critical delays, missed commitments, decisions and a daily MD digest. Provide
per-event preferences rather than mirroring every event to every channel.

| Event | Immediate audience | Delivery proposal |
| --- | --- | --- |
| Job published | Assigned participants | Portal; chosen instant channel |
| Drawing released/revised | Purchase, Production and affected Quality owners | Portal + chosen instant channel; acknowledgment required where relevant |
| Arrival ETA committed/changed | Planning and affected downstream owners | Portal + chosen instant channel |
| Department ready | Accountable owner, department backup | Portal + instant alert; 24-hour clock |
| Missed date or delay report | MD, Planning, accountable and impacted owners | Portal + instant alert + critical email |
| Routine progress | Job followers | Portal activity; digest rather than broadcast email |
| Machine breakdown | Maintenance, Production, Planning; Purchase if spares needed | Portal + instant alert; MD if delivery risk |

Track event creation, channel queued/sent/failed and explicit acknowledgment
separately. Provider acceptance is not proof that a person read the message.
Retry with deduplication; delivery failures never roll back operational facts or
advance a handoff. Escalate an unacknowledged critical alert to a backup owner.
Show notification health/quota warnings to administrators.

Telegram's ordinary bot throughput is free within its limits. Brevo currently
offers 300 emails/day shared across recipients. WhatsApp automated outbound
messages are not an unlimited free channel; SMS is metered. Web Push is a useful
later alternative to requiring Telegram, with no per-message gateway purchase
in a direct implementation, but still needs development/hosting, HTTPS and user
permission. iOS requires a supported Home Screen web app. No channel guarantees
delivery/read acknowledgment. Hosting/storage are separate from messaging fees.

Sources checked October 22, 2026:
- https://core.telegram.org/bots/faq
- https://help.brevo.com/hc/en-us/articles/208580669-FAQs-What-are-the-limits-of-the-Free-plan
- https://business.whatsapp.com/products/platform-pricing
- https://www.twilio.com/en-us/sms/pricing/in
- https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/

## Implementation sequence

1. Confirm material sources, Planning publishing authority, coating order, receipt
   closure ownership, partial-batch release rules and the elapsed-hour window.
2. Add structured material/receipt/inspection records, released drawing revisions,
   department membership visibility and publisher capabilities. Preserve current
   jobs, permissions and notification behavior until migrated deliberately.
3. Extend task readiness from one predecessor to explicit prerequisite gates;
   migrate existing dependsOnId edges without losing their behavior. Add parallel
   preparation and configure job-specific operations/optional stages.
4. Add department handoff reports, lot-based quantity reconciliation, partial
   completion/dispatch, outside processing and maintenance incidents.
5. Introduce event/audience/channel routing, acknowledgment, quiet digests and
   channel preferences. Pilot with Telegram + critical email before Web Push.
6. Pilot one purchased-material job and one customer-material job. Test late and
   missing reports, duplicate delivery, partial receipts, rejects/replacements,
   changed drawings, simultaneous completion, machine breakdown, rework, channel
   failure and dispatch balance. Verify old routes/workflows still work.

This proposal retains Next.js/React/TypeScript, PostgreSQL/Prisma, the existing
queue, file storage, authentication and audited service layer. It needs domain
changes, not a framework replacement.
