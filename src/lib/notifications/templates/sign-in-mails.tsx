/**
 * Sign-in-link mails. Sent straight from the web app, not through the
 * notification table: a usable login link must never sit in a row that the
 * in-app inbox shows, and the person is waiting at the login screen for it.
 */
import { plainTextSelectors, render } from '@react-email/render';

import { ActionButton, EmailLayout, FactTable, Heading, Paragraph } from './layout';

export interface RenderedSignInMail {
  subject: string;
  html: string;
  text: string;
}

const PLAIN_TEXT_OPTIONS = {
  selectors: [...plainTextSelectors, { selector: 'table', format: 'dataTable' }],
};

async function renderMail(subject: string, element: React.ReactElement) {
  const [html, text] = await Promise.all([
    render(element, { pretty: false }),
    render(element, { plainText: true, htmlToTextOptions: PLAIN_TEXT_OPTIONS }),
  ]);
  return { subject, html, text };
}

export interface SignInLinkPayload {
  name: string;
  link: string;
  minutesValid: number;
}

function SignInLinkEmail({ name, link, minutesValid }: SignInLinkPayload) {
  return (
    <EmailLayout preview="Your JTAS sign-in link">
      <Heading>Your sign-in link</Heading>
      <Paragraph>Dear {name},</Paragraph>
      <Paragraph>
        Your request to sign in to JTAS was accepted. Use the button below to sign in. The link
        works once and expires in {minutesValid} minutes.
      </Paragraph>
      <ActionButton href={link} label="Sign in to JTAS" />
      <Paragraph>
        If you did not ask to sign in, ignore this mail and tell the administrator.
      </Paragraph>
    </EmailLayout>
  );
}

export function renderSignInLinkMail(payload: SignInLinkPayload): Promise<RenderedSignInMail> {
  return renderMail('[JTAS] Your sign-in link', <SignInLinkEmail {...payload} />);
}

export interface SignInRequestedPayload {
  approverName: string;
  requesterName: string;
  requesterEmail: string;
  requesterRole: string;
  department: string | null;
  requestedAtIst: string;
  ipAddress: string | null;
  reviewLink: string;
}

function SignInRequestedEmail(payload: SignInRequestedPayload) {
  return (
    <EmailLayout preview={`${payload.requesterName} is asking to sign in`}>
      <Heading>Someone is asking to sign in</Heading>
      <Paragraph>Dear {payload.approverName},</Paragraph>
      <Paragraph>
        <strong>{payload.requesterName}</strong> asked for a sign-in link. Accept it in JTAS and the
        link goes to their mailbox. Decline it if you do not expect this.
      </Paragraph>
      <FactTable
        rows={[
          ['Account', `${payload.requesterName} <${payload.requesterEmail}>`],
          ['Role', payload.requesterRole],
          ['Department', payload.department],
          ['Asked at', `${payload.requestedAtIst} IST`],
          ['From address', payload.ipAddress],
        ]}
      />
      <ActionButton href={payload.reviewLink} label="Review the request" />
    </EmailLayout>
  );
}

export function renderSignInRequestedMail(
  payload: SignInRequestedPayload,
): Promise<RenderedSignInMail> {
  return renderMail(
    `[JTAS] Sign-in request: ${payload.requesterName}`,
    <SignInRequestedEmail {...payload} />,
  );
}
