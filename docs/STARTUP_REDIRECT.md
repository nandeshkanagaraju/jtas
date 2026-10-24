# Startup session-refresh redirects

Android launches `/`. If the access cookie has expired, middleware redirects to
`GET /api/auth/refresh?next=...`. Behind the production proxy, Next can expose its
internal bind address (`0.0.0.0:3000`) in `request.url`.

The redirect contract is unchanged except that every Location uses the configured
public `APP_BASE_URL` origin. Local environments without this setting fall back to
the request origin. Forwarded or Host headers do not override the configured origin.

- Valid refresh cookie: rotate the session, set the existing session cookies and
  redirect to the requested local path, preserving its query.
- Missing refresh cookie: clear session cookies and redirect to `/login`.
- Invalid, expired or revoked refresh cookie: clear session cookies and redirect
  to `/login?next=...`, retaining the local destination.
- External return destinations, including backslash normalization, fall back to `/`.

POST refresh responses, authentication lifetimes and the Android installer remain
unchanged. Tests cover internal request URLs, redirect outcomes and first navigation
with only a refresh cookie.
