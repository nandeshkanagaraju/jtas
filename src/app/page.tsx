import { redirect } from 'next/navigation';

/**
 * The root is never a landing page — JTAS has no public surface. Middleware
 * (M1) redirects unauthenticated visitors to `/login` and sends authenticated
 * ones to their role's home screen; this redirect is the fallback for the
 * brief window before middleware runs.
 */
export default function RootPage() {
  redirect('/login');
}
