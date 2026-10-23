# Live job centre

Open **Live updates** (`/updates`) from the workspace navigation, the installed phone's **More** menu, **Notifications**, or the Activity section on a job. Every participant assigned to a job can follow all its departments; unrelated jobs remain hidden. MD/Deputy/Admin retain their existing read access. Admin collaboration remains read-only.

Choose a job to see its actual dependency map, current department(s), progress, owners, deadlines, waiting stages and open problems. Parallel work shows multiple current departments. Held, draft, completed and cancelled jobs do not claim an active department. The map draws actual prerequisites rather than assuming a fixed linear chain.

The shared timeline combines existing transactional audit history, comments, deadline changes, handoffs, problems and files. Filter by department task and update type. **Post an update** records a normal task comment, so existing job participants see it both in the centre and the original task. Existing mention behaviour and server permissions apply; posting does not silently send a message to every employee. Messages remain as written, are rendered as plain text, and are not machine-translated. The UI supports English, Tamil and Hindi.

Visible screens refresh automatically five seconds after each completed read. Hidden tabs stop polling; returning online or to the tab refreshes immediately. Only successful responses replace the last snapshot. Failures show a paused/stale indicator and retain unsent text. Revoked access clears returned job data. Read requests are cancelled on navigation and time out after 15 seconds. Concurrent expired requests share one token refresh per tab.

Older updates use a stable timestamp/id cursor and bounded 40-row pages. Viewing older history is explicitly labelled; **Back to live** returns to current events. Query filtering and limits apply in SQL before comment/problem joins, excluding redundant job status recomputation rows. IP addresses, authentication audits and internal field diffs are not exposed by the centre.

No new database tables, workflow state machine changes, production seeds or notification-worker schedules are required. Personal notifications remain separate from the shared job timeline. Physical Android notification testing remains an acceptance check for the separately published signed APK; the centre runs in that app, existing PWA installations and ordinary web browsers.

Verification covers participant/outsider access, read-only admin permissions, parallel/held/completed progress, cross-department comments, equal-timestamp pagination, polling cleanup/offline states, concurrent refresh, actual two-user message delivery and successful handoffs, and Tamil/Hindi layouts at 320px, 390px and wide desktop widths.
