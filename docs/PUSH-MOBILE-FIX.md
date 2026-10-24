# Mobile task access and background push

Existing POST /api/push/test contract is preserved: same-origin authenticated, real user, current session owns the supplied endpoint, 3 requests per minute. Optional delaySeconds accepts only 0 (default) or 15; invalid values return 400. Success returns {sent: true} after the push provider accepts the request. This does not prove phone display. The 15-second test is owned by the server, so backgrounding the client does not cancel it; a server restart can interrupt this diagnostic test. No jobs, deadlines or workflow notifications are created by this test.

Visible workflow and test pushes request high Web Push urgency, allowing prompt delivery when Android is idle. Workflow alerts remain available to an offline device for 24 hours; tests for five minutes. A session must remain valid; sign-out still removes its registrations. Android and browser notification and battery settings remain authoritative.

On the installed phone, task code, title, status and due date share one large link. A separate Open task / Set deadline button makes the action explicit. Existing start, complete and report controls remain independent. Live updates is a persistent bottom tab; account and notification settings are direct menu links. Desktop presentation is unchanged.

Acceptance: enable notifications, choose Test with app closed, immediately go Home and lock the phone. Check the alert and tap it back into notification settings. Repeat after swiping Jaraa from recents. Force-stopping Chrome or Jaraa through Android Settings is a different state and can prevent delivery until reopened. Verify on the actual target phone before claiming delivery is fixed.
