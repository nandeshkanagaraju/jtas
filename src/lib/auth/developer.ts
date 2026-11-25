/**
 * Who may change passwords.
 *
 * Passwords are set by the organisation. Two exceptions, at the MD's request:
 * the Managing Director may change their own, and a developer (an email listed
 * in `DEVELOPER_EMAILS`) may change their own and set anyone's. Everyone else
 * asks the developer or the administrator.
 */
import { env } from '@/lib/utils/env';

interface PasswordSubject {
  email: string;
  role: string;
}

function developerEmails(): Set<string> {
  return new Set(
    (env().DEVELOPER_EMAILS ?? '')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
}

/** Every configured developer address, lowercased. */
export function developerEmailList(): string[] {
  return [...developerEmails()];
}

/** May this person accept or decline sign-in-link requests? */
export function canApproveSignIn(user: Pick<PasswordSubject, 'email'>): boolean {
  return isDeveloper(user);
}

export function isDeveloper(user: Pick<PasswordSubject, 'email'>): boolean {
  return developerEmails().has(user.email.trim().toLowerCase());
}

/** May this person change their own password from the app? */
export function canChangeOwnPassword(user: PasswordSubject): boolean {
  return user.role === 'MD' || isDeveloper(user);
}

/** May this person set another account's password to a value they choose? */
export function canSetAnyPassword(user: Pick<PasswordSubject, 'email'>): boolean {
  return isDeveloper(user);
}
