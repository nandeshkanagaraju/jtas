# JTAS — go-live checklist

Work down it. Nothing here is optional, and one item is **blocking**: JTAS is a
system whose entire value is that its emails arrive, so an installation that
cannot deliver mail is not live, however good the screens look.

Tick as you go and keep the filled-in copy.

---

## A. Infrastructure

- [ ] A VPS with **2 vCPU and 4 GB RAM** minimum, running a current Linux with
      Docker and the Compose plugin.
- [ ] **Two DNS A records** pointing at it:
      - [ ] `jtas.<your-domain>` — the application
      - [ ] `files.jtas.<your-domain>` — attachments
      Both are required. Presigned upload and download URLs are signed over the
      host *and* the path, so attachments cannot live on a path prefix of the
      main domain. See the comments in `Caddyfile`.
- [ ] Ports **80 and 443** open. Port 80 is not optional — the TLS certificate
      is issued over it.
- [ ] `.env.production` created from `.env.production.example`, with:
      - [ ] `JWT_SECRET` and `REFRESH_SECRET` generated fresh
            (`openssl rand -base64 48`), never reused between environments
      - [ ] `POSTGRES_PASSWORD` and `MINIO_ROOT_PASSWORD` generated, not typed
      - [ ] `ACME_EMAIL` a mailbox somebody reads — expiry warnings go there
- [ ] `docker compose -f docker-compose.prod.yml up -d` brings up all seven
      services.
- [ ] `https://jtas.<your-domain>` serves with a valid certificate.
- [ ] `curl -s https://jtas.<your-domain>/api/health | jq` returns `ok: true`.

## B. Mail deliverability — **blocking**

Do this before anything else that costs time. If these three records are wrong,
Gmail will silently bin every notification, and the first anyone knows is a
missed delivery.

- [ ] **SPF** — the sending domain publishes a TXT record authorising the relay.
      Verify: `dig +short TXT <your-domain> | grep spf`
- [ ] **DKIM** — the relay's signing key is published and the relay is signing.
      Verify from a received message's headers: `dkim=pass`.
- [ ] **DMARC** — a TXT record at `_dmarc.<your-domain>`, at minimum
      `v=DMARC1; p=none; rua=mailto:...` so you find out about failures.
      Verify: `dig +short TXT _dmarc.<your-domain>`
- [ ] Send a test to a **Gmail** address and open *Show original*. All three
      must read **PASS**. Anything else is a fail, not a warning.
- [ ] The message landed in **Inbox**, not Spam or Promotions.
- [ ] Confirm the VPS provider does not block outbound SMTP. Several block 25
      by default and some block 587 on new accounts; find out now rather than
      at 6 PM on the first day.

> Until every box in section B is ticked, do not go live. Everything else in
> JTAS degrades gracefully. This does not: it fails silently and looks fine.

## C. Data (SDD 10.5 steps 1–2)

- [ ] **Eight departments** seeded, in shop sequence: Planning, Purchase, Store,
      Production, Quality, Dispatch, Accounts, HR.
- [ ] **The MD account** created, with the real address.
- [ ] **One member per department**, each with their real address.
- [ ] Temporary passwords handed over in person, and `.seed-credentials.txt`
      deleted from the server afterwards.
- [ ] Every account has signed in once and changed its password.
- [ ] **Working hours** set to the shop's actual hours and days
      (Settings → Working hours).
- [ ] The **2026–27 holiday list** entered (Settings → Holidays), so a deadline
      does not land on a day the shop is shut.
- [ ] The **standard CNC job template** reviewed against how work really flows
      here, and its offsets adjusted.
- [ ] No demo or showcase data in the production database:
      `SELECT count(*) FROM "Job" WHERE "isDemo";` returns **0**.

## D. Delivery to every user (SDD 10.5 step 3)

- [ ] A test mail sent to **every** user, not a sample.
- [ ] Each person has confirmed, by replying or in person, that it arrived in
      their **inbox**.
- [ ] Anyone on a corporate mail system with aggressive filtering has JTAS
      allow-listed.

## E. One real job, end to end (SDD 10.5 step 4)

With the actual MD, in staging or as the first real job:

- [ ] The MD creates a job from the template and publishes it.
- [ ] Each assignee receives the assignment mail.
- [ ] The first member completes their step; the next becomes actionable on its
      own, and its owner is emailed.
- [ ] Somebody reports a problem; the MD receives it and resolves it with
      **Give more time**.
- [ ] The member sees the new deadline and finishes.
- [ ] The dashboard's on-time figure reflects what happened.
- [ ] An overdue escalation has been observed at least once — set a deadline an
      hour out and let it pass, rather than taking it on trust.

## F. Operations

- [ ] The nightly backup has run: `docker compose -f docker-compose.prod.yml
      logs backup` shows an upload, and `mc ls store/jtas-backups` lists it.
- [ ] **A restore has actually been performed** onto this server, and the result
      recorded in [RUNBOOK.md](RUNBOOK.md#restore). A backup nobody has restored
      is a hope.
- [ ] An external uptime check polls `/api/health` and alerts a person. The
      endpoint answers **503** when the scheduler has been dead for twenty
      minutes; nothing else will tell you.
- [ ] `SENTRY_DSN` and `NEXT_PUBLIC_SENTRY_DSN` set, and a deliberate test error
      seen arriving.
- [ ] Somebody other than the person who installed it has read
      [RUNBOOK.md](RUNBOOK.md) and knows where it is.
- [ ] The deploy and rollback commands have each been run once, on purpose,
      before they are needed in anger.

## G. People (SDD 10.5 steps 5–6)

- [ ] Members trained on **one screen only: My Tasks**. Not the dashboard, not
      reports. One screen, three buttons.
- [ ] Every member has [MEMBER_GUIDE.md](MEMBER_GUIDE.md), printed or on their
      phone.
- [ ] The MD has read [ADMIN_GUIDE.md](ADMIN_GUIDE.md).
- [ ] **Announced that verbal status updates are no longer accepted.** This is
      the one that decides whether the system is used. If "I told him on the
      floor" still counts, the data goes stale within a fortnight and the
      dashboard becomes fiction.
- [ ] The MD has committed to clearing the problem inbox daily. A blocker
      sitting for two days teaches the shop that reporting one is pointless.

---

## Day one

- [ ] Watch `/api/health` through the first morning.
- [ ] Check the first daily digest arrived and reads correctly.
- [ ] Ask three members whether they got their mail, rather than assuming.
- [ ] Check `failedLastHour` is zero at the end of the day.

## Week one

- [ ] Every member has completed at least one task through the system.
- [ ] At least one problem has been raised and resolved through the system
      rather than on the floor.
- [ ] The on-time figure is being read, and believed.
