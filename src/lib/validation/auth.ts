/**
 * Auth request shapes. One definition per shape (architecture rule 4), imported
 * by both the react-hook-form resolver on the client and the route handler on
 * the server, so the two can never disagree about what is valid.
 */
import { z } from 'zod';

/**
 * Password policy, SDD section 8.1: at least 8 characters with a letter and a
 * digit. The common-password rejection lives in `@/lib/auth/password` rather
 * than here — it is a list lookup, and keeping it out of the schema means the
 * client bundle does not ship the blocklist.
 */
export const passwordSchema = z
  .string()
  .min(8, 'Use at least 8 characters.')
  .max(128, 'Use at most 128 characters.')
  .regex(/[A-Za-z]/, 'Include at least one letter.')
  .regex(/\d/, 'Include at least one digit.');

export const emailSchema = z
  .string()
  .trim()
  .min(1, 'Enter your email address.')
  .email('Enter a valid email address.')
  // Stored lowercase so a login cannot fail on capitalisation.
  .toLowerCase();

export const loginSchema = z.object({
  email: emailSchema,
  // Not `passwordSchema`: an existing password predates the policy, and
  // applying the rules here would tell an attacker which passwords are
  // well-formed. Any non-empty string is accepted and then verified.
  password: z.string().min(1, 'Enter your password.'),
  /**
   * FR-04. Extends the refresh token from one working day to 30 days on a
   * device the user says is theirs.
   */
  rememberDevice: z.boolean().optional().default(false),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password.'),
    newPassword: passwordSchema,
    confirmPassword: z.string().min(1, 'Re-enter the new password.'),
  })
  .refine((value) => value.newPassword === value.confirmPassword, {
    message: 'The two passwords do not match.',
    path: ['confirmPassword'],
  })
  .refine((value) => value.newPassword !== value.currentPassword, {
    message: 'The new password must be different from the current one.',
    path: ['newPassword'],
  });

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
