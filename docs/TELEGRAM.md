# Telegram

Telegram is a second way to receive a JTAS message and to act on it. Email is still sent. A person with no linked chat gets the email and nothing else, and that is not an error.

A linked chat id is weaker identification than a signed-in session. Anyone holding that phone can press the buttons. The audit log records `Telegram` as the source on those actions so the record says so. A signed-in session is recorded as `Signed-in session`.

## What you do in BotFather

1. Open [@BotFather](https://t.me/BotFather) in Telegram.
2. Send `/newbot`.
3. Name: `JTAS`. Username: something that ends in `bot`, for example `jaraa_jtas_bot`.
4. BotFather replies with a token. Put it in the server `.env` as `TELEGRAM_BOT_TOKEN`. Do not commit it and do not put it in the image.
5. Send `/setjoingroups`, choose the bot, and choose **Disable**. The bot is for a private chat with one person. It ignores groups anyway.
6. Leave privacy mode on. Leave inline mode off. There is no payment, no admin right, and no extra scope. The token is the only credential.

Then on the server `.env`:

```
TELEGRAM_BOT_TOKEN=the token from BotFather
TELEGRAM_WEBHOOK_SECRET=the output of: openssl rand -hex 32
TELEGRAM_BOT_USERNAME=jaraa_jtas_bot
```

`TELEGRAM_BOT_USERNAME` is the username without `@`. It is shown next to the link code on Your account.

Redeploy so the app and the worker see the three values. On boot the worker calls `setWebhook` for `https://<the site>/api/telegram/webhook` and gives Telegram the secret. Every update is rejected unless that secret comes back in `X-Telegram-Bot-Api-Secret-Token`.

Local development does not register a webhook, because Telegram cannot reach `http://localhost`.

## Why a webhook

The site is already on HTTPS. Telegram posts an update as soon as a button is pressed, and any app process can answer it. Long polling would sit inside the worker and go quiet for the whole of a restart. The secret check is what makes the public path safe.

## What a person does

On **Your account**, Get a link code. The page shows `t.me/<bot>` with the code attached, so opening it sends `/start` and the code. The code works once, for 15 minutes. A used code is refused. A code that does not exist gets no reply. Unlink is on the same page.

A job arrives as two messages. The first is the timeline: every department, its date, and what was recorded. The second is that person's own work and deadline, and it carries the buttons. Email is unchanged.

Buttons on an assignment, a reminder, an overdue notice, and a ready-to-start notice: Start work (while it is still pending), Mark completed, Report problem, +2 days, +5 days, +1 week, Set deadline, and Attach a file. After Mark completed, the bot asks for the finished files and keeps Attach a file available so another photo or PDF can be added. Set deadline is typed as DD/MM. A commitment message offers the same dates, with Other date in place of Set deadline. Other date is typed as DD/MM. The bot shows the date it understood and waits for Confirm before it writes anything. Report problem asks Low, Medium, or High, then the description. An approval notice offers Approve and Send back. Those buttons call the same services as the website.

The same actions work after the message has gone, from the command menu:

- `/tasks` — open work. Tap one to make it the current task.
- `/job JGE-2026-0003` — the timeline for that job.
- `/startwork` — start the current task. `/start` is only for linking an account.
- `/done` — mark the current task completed.
- `/problem` — report a problem on the current task.
- `/file` — then send a photo or a PDF.
- `/help` — the list above.

The current task is the last one this chat was notified about, or the one picked from `/tasks`. A command with no current task shows `/tasks`. Hold, cancel, reassign, and moving a deadline stay on the website.
