# Mail setup

How JTAS sends email, how to point it at Brevo, and what must be true on the
`jaraaglobal.com` domain before go-live.

---

## 1. The two providers

`MAIL_PROVIDER` selects the adapter. The registry resolves it once, and the
sweeper never learns which one it got (SDD 5.5).

| `MAIL_PROVIDER` | Adapter | Used for |
| --- | --- | --- |
| `smtp` *(default)* | `channels/email.ts`, Nodemailer | Local development against Mailpit, and any real SMTP relay |
| `brevo` | `channels/brevo.ts`, Brevo transactional API | The hosted environment |

The default is `smtp` on purpose: a developer who pulls this branch keeps
sending to Mailpit on `localhost:1025` and nothing about their setup changes.

### Why the HTTP API and not Brevo's SMTP relay

Brevo offers both, and SMTP would have been a two-line configuration change.
The API is used because it names its failures. Over SMTP, "you are out of
credits for today" and "that mailbox does not exist" both arrive as a numeric
code and a string — so the first gets retried five times against a limit that
cannot move until midnight, and then the message is marked FAILED and never
sent at all. The API returns `not_enough_credits`, which the adapter maps to a
distinct error that stops the pass and leaves the row `PENDING`.

---

## 2. Environment

```dotenv
MAIL_PROVIDER="brevo"
BREVO_API_KEY="xkeysib-..."          # Brevo → SMTP & API → API keys
MAIL_FROM="you@example.com"
MAIL_FROM_NAME="JTAS"

# Guards. See section 4.
MAIL_ALLOWLIST="you@example.com,member@example.com"
MAIL_DAILY_CAP="250"
```

`MAIL_FROM` also accepts the `Name <address>` form; the adapter splits it and
`MAIL_FROM_NAME` is then the fallback only.

**Never commit these.** `.env` is git-ignored; `.env.example` documents the keys
with empty values.

---

## 3. Verifying the sender

Brevo refuses to send from an address it has not verified. Before the first
send:

1. Brevo → **Senders, Domains & Dedicated IPs** → **Senders** → **Add a sender**
2. Enter `MAIL_FROM` and the display name.
3. Brevo emails that address a confirmation link. Click it.
4. The sender shows a green tick.

Until this is done every send returns `401`/`403`, which the adapter classifies
as permanent — so the row fails on the first attempt rather than retrying.
That is deliberate: a misconfigured sender is not a transient condition.

### ⚠ A verified freemail sender is silently rewritten — and nothing tells you

**This was observed, not theorised. It cost a full debugging cycle.**

A `@gmail.com` sender can be verified, show `active: true`, and still never be
used as the From address. Brevo will not send with a From domain it cannot
authenticate, and nobody can authenticate `gmail.com` — publishing DNS for it
is Google's privilege, not ours. So Brevo **substitutes its own subdomain** and
sends anyway:

```
we set        MAIL_FROM = you@gmail.com            (verified, active)
Brevo sent as you@12289361.brevosend.com           (<user_id>.brevosend.com)
```

Gmail then received mail from an unknown, unwarmed subdomain claiming to
represent a Gmail user, and dropped both messages silently. Not spam, not
Promotions — **absent**, with `in:anywhere` finding nothing.

The `gmail.com` above is the point, not an incidental detail: the substitution
happens for *any* domain absent from the authenticated list, and a freemail
domain can never be on it.

What makes this expensive is how thoroughly it looks like success at every
layer we control:

| Where you look | What it says | Reality |
| --- | --- | --- |
| Our adapter | `201`, `messageId` returned, row `SENT` | Accepted, not delivered |
| `/v3/smtp/statistics/events` | `requests` only — no bounce, no block, no defer | Silence is not success |
| `/v3/smtp/statistics/aggregatedReport` | `requests 2, delivered 0`, all else `0` | The only honest signal |
| Account credits | `300 → 298` | Charged regardless |
| Brevo Logs UI, status column | **"Sent"** | Sent *as something else* |
| Brevo Logs UI, **From column** | `...@12289361.brevosend.com` | ← the only place it is visible |
| `/v3/senders` | `active: true`, no other state | No hint of substitution |

There is no error, no warning, and no field on the sender record that says
"this address will be rewritten". The `requests`-without-`delivered` pattern is
easy to misread as a queue still draining, or as an account pending review; it
is neither.

**The one API call that would have caught it before sending:**

```bash
curl -s -H "api-key: $BREVO_API_KEY" https://api.brevo.com/v3/senders/domains
# {"domains":[],"count":0}   ← no authenticated domain: every From will be rewritten
```

An empty `domains` list means nothing you put in `MAIL_FROM` will survive,
whatever `/v3/senders` claims. Check the **From column** in Logs after any
first send to a new provider, and check `senders/domains` before one.

### So a Gmail from-address proves less than it appears to

It is still useful scaffolding — it exercises the adapter, the error mapping,
the retry and quota logic, the allowlist, the templates and the deep links, all
of which were confirmed working by the run above. What it cannot do is deliver
mail or demonstrate deliverability, because:

- **The From domain is never ours.** Either Brevo rewrites it to
  `<user_id>.brevosend.com`, as it did, or — with a domain we do control — it
  sends aligned. There is no third option in which `gmail.com` works.
- **`gmail.com` publishes `v=DMARC1; p=none; sp=quarantine`.** Relayed through
  Brevo, neither SPF nor DKIM aligns with `gmail.com`, so the message is
  unauthenticated mail claiming to be from Gmail, arriving at Gmail. `p=none`
  is the only reason it is not rejected outright.

The real test of deliverability happens after section 5, and not before.

---

## 4. The guards

Two things stand between the sweeper and the relay. Both are on `/api/health`,
because both fail silently — a cap quietly reached and a roster quietly off the
allowlist look identical from outside: no mail arrives.

### `MAIL_ALLOWLIST`

Comma-separated. While non-empty, **only** these addresses receive mail.
Everything else is written `SUPPRESSED` with the reason on the row, and still
appears in that user's in-app inbox, so a flow can be tested end to end without
a message leaving the building. Empty disables the guard — the production
posture, once the roster is real.

**The full address is matched, including any plus-tag.** `you+hr@example.com` is
**not** covered by `you@gmail.com` being on the list, even though Gmail
delivers both to the same inbox. This is deliberate and tested: the roster is
headed for plus-addressed mailboxes, and a matcher that collapsed the tag would
treat all seven departments as the one allowlisted address and mail every one
of them.

### `MAIL_DAILY_CAP`

Defaults to **250**, against Brevo's free-tier **300 per day**. Counted over the
IST day on rows that actually went out — the day the factory works, and a cap
that rolled over at 05:30 local would empty mid-morning.

On reaching the cap the sweeper stops dispatching and leaves the remaining rows
`PENDING`, not `FAILED`: nothing is wrong with them, and they go out after
midnight without having burned a retry. The 50-mail margin leaves room for a
password reset or a test send.

If Brevo reports its own quota exhausted first — a shared limit, a suspended
account, a day's counting that disagrees with ours — the adapter raises
`ProviderQuotaError`, the pass stops, and the rows are held the same way.

---

## 5. Go-live prerequisite: SPF, DKIM and DMARC on `jaraaglobal.com`

**This is not optional and it is not a tuning exercise.** SDD 10.4 is explicit:
without these records the overdue mails land in spam and the product fails
quietly — which is the exact failure the whole system exists to prevent. A
member who never sees the chase has not been chased.

Do this before go-live, not after the first complaint.

### Step 1 — authenticate the domain in Brevo

Brevo → **Senders, Domains & Dedicated IPs** → **Domains** → **Add a domain** →
`jaraaglobal.com`. Brevo then shows the exact records, including a DKIM public
key **generated for this account**. Use the values Brevo displays; the DKIM
key below is a placeholder and will not work.

### Step 2 — publish the DNS records

At whoever hosts DNS for `jaraaglobal.com`:

| Type | Host | Value | Notes |
| --- | --- | --- | --- |
| `TXT` | `@` | `v=spf1 include:spf.brevo.com mx ~all` | Merge into the existing SPF record if one exists — **a domain may publish only one**, and two is a failure, not a fallback. |
| `TXT` | `mail._domainkey` | `k=rsa; p=MIGfMA0GCSq...` | Brevo generates this. Copy it exactly; a wrapped or truncated key fails silently. |
| `TXT` | `_dmarc` | `v=DMARC1; p=none; rua=mailto:dmarc@jaraaglobal.com; pct=100; aspf=r; adkim=r` | Start at `p=none`. See step 4. |
| `TXT` | `@` | `brevo-code:<code from Brevo>` | Ownership check. May be removed once verified. |

Brevo may also ask for a `CNAME` for tracked links
(`mail.jaraaglobal.com` → `brevo.com`). Add it if shown; without it, click
tracking uses a Brevo hostname, which reads as a mismatch to some filters.

### Step 3 — verify

Back in Brevo, press **Verify**. DNS propagation is usually minutes and can be
up to 48 hours. Independent checks:

```bash
dig +short TXT jaraaglobal.com              # SPF — expect exactly one v=spf1
dig +short TXT mail._domainkey.jaraaglobal.com
dig +short TXT _dmarc.jaraaglobal.com
```

Then send one real message to a Gmail address and use **Show original**. All
three of `SPF`, `DKIM` and `DMARC` must read **PASS**.

### Step 4 — tighten DMARC

Leave `p=none` for **two to four weeks** and read the `rua` aggregate reports.
`p=none` means "report, do not act", so a mistake costs visibility rather than
delivery. Once the reports show only expected sources:

- `p=quarantine` for a fortnight, then
- `p=reject`.

Going straight to `p=reject` will silently destroy mail from anything else that
sends as `jaraaglobal.com` — the ERP, a scanner, a copier, an invoicing tool —
and the failure surfaces as "the customer never got the invoice", weeks later
and far from its cause.

### Step 5 — switch `MAIL_FROM`

Only after `SPF`, `DKIM` and `DMARC` all pass:

```dotenv
MAIL_FROM="JTAS <notifications@jaraaglobal.com>"
MAIL_FROM_NAME="JTAS"
```

Then clear `MAIL_ALLOWLIST` and raise `MAIL_DAILY_CAP` to match the paid plan,
if one has been bought. **Do not clear the allowlist while the roster still
holds `@jaraaglobal.com` placeholders that have no mailbox** — each is a hard
bounce, and bounces are what a new sending reputation is judged on.

---

## 6. Checking it works

```bash
curl -s localhost:3000/api/health | jq '{mailSentToday, mailDailyCap, mailQuotaRemaining, suppressedToday}'
```

- `mailQuotaRemaining` falling as expected → mail is going out.
- `suppressedToday` climbing while `mailSentToday` stays at zero → the
  allowlist is holding everything back. Usually correct during testing, and the
  first thing to check when "no mail arrives".
- `failedLastHour` above zero → real delivery failures; read `lastError` on the
  `FAILED` rows.

The Brevo dashboard's **Transactional → Logs** shows what the provider did with
each message, keyed by the `X-JTAS-Notification` header, which carries the
notification row id.

---

## 7. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| **Rows `SENT`, Brevo logs say "Sent", nothing arrives, `in:anywhere` finds nothing** | **From rewritten to `<user_id>.brevosend.com` because no domain is authenticated** | **Section 3 — check the From column in Logs and `/v3/senders/domains`; the fix is section 5** |
| `requests` logged but `delivered` stays 0, no bounce | Same as above. Silence is the symptom | Section 3 |
| Every row `FAILED` on the first attempt, `401` | Key wrong, or sender not verified | Section 3 |
| Rows stay `PENDING`, log says daily cap | `MAIL_DAILY_CAP` reached | Expected; they go out after IST midnight |
| Rows `SUPPRESSED`, reason names the address | Not on `MAIL_ALLOWLIST` | Expected during testing; section 4 |
| Nothing sends, no rows at all | Recipient is a demo account | `User.isDemo` — `seed:demo`/`seed:showcase` accounts never receive mail |
| Mail arrives in Promotions or Spam | Gmail from-address, or missing SPF/DKIM/DMARC | Section 5 — this is the prerequisite, not a tuning problem |
| `MAIL_PROVIDER=brevo` but Mailpit still receives | Stale process | The adapter resolves once per process; restart `pnpm worker` |
