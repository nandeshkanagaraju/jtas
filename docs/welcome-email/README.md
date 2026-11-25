# Welcome email for a new login

The email each person gets when their JTAS login is created. It is sent by hand
from the developer's Gmail (nandeshjeyalakshmi@gmail.com), not by the app.

`welcome-template.html` is the exact HTML that was sent to the department logins on
24 and 25 November 2026. It has three placeholders:

| Placeholder | Example                    | Where                           |
| ----------- | -------------------------- | ------------------------------- |
| `{{NAME}}`  | `Dhiyaneswar S`            | the heading and "Dear …" (twice) |
| `{{EMAIL}}` | `marketing@jaraaglobal.in` | the Username row                |
| `{{DEPT}}`  | `Marketing`                | the Department row              |

It never contains a password. The logo and the button point at the live site.

## Sending one

1. Create the account first (for a department login:
   `node .deploy/add-<name>-production.cjs --apply`, or
   `pnpm users:provision-departments --yes --only <email>` against production), and
   add the address to the email function's `MAIL_ALLOWLIST`.
2. In Gmail, compose a new mail. To: the address. Subject:
   `Welcome to JTAS – your sign-in details` (with an en dash).
3. Paste the template as HTML with the three placeholders filled in. Gmail ignores a
   plain clipboard paste of HTML; dispatching a `paste` event with `text/html` on the
   message body works, or forward an earlier welcome mail and edit the name, username
   and department (delete the "Forwarded message" lines and the `Fwd:`).
4. Check the recipient, subject, name, username, department and logo, then send.
