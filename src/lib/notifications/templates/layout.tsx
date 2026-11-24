/**
 * The shell every JTAS mail shares — SDD section 5.4.
 *
 * Tables and inline styles only, no external CSS: these mails are read on
 * Gmail mobile on a shop floor and in Outlook web in an office. The one image
 * is the Jaraa logo, served from the app itself; with images blocked its alt
 * text stands in and nothing else depends on it.
 */
import {
  Body,
  Container,
  Head,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
} from '@react-email/components';

import { logoUrl } from './links';

export const COLORS = {
  text: '#0f172a',
  muted: '#64748b',
  border: '#e2e8f0',
  background: '#f8fafc',
  /** Jaraa blue, from the logo. */
  accent: '#1f6fbf',
  /** Jaraa orange, from the logo. */
  brandOrange: '#e8892b',
  page: '#eef3f9',
  overdue: '#be123c',
  problem: '#b45309',
} as const;

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export function EmailLayout({ preview, children }: { preview: string; children: React.ReactNode }) {
  return (
    <Html lang="en">
      <Head />
      {/* The line Gmail shows beside the subject in the list. */}
      <Preview>{preview}</Preview>
      <Body
        style={{ backgroundColor: COLORS.page, fontFamily: FONT, margin: 0, padding: '24px 0' }}
      >
        <Container
          style={{
            backgroundColor: '#ffffff',
            border: `1px solid ${COLORS.border}`,
            borderRadius: 12,
            margin: '0 auto',
            maxWidth: 600,
            overflow: 'hidden',
          }}
        >
          {/* Brand stripe: Jaraa blue with the orange of the logo's arc. */}
          <table cellPadding={0} cellSpacing={0} role="presentation" style={{ width: '100%' }}>
            <tbody>
              <tr>
                <td
                  style={{
                    backgroundColor: COLORS.accent,
                    height: 5,
                    lineHeight: '5px',
                    fontSize: 0,
                    width: '78%',
                  }}
                >
                  &nbsp;
                </td>
                <td
                  style={{
                    backgroundColor: COLORS.brandOrange,
                    height: 5,
                    lineHeight: '5px',
                    fontSize: 0,
                  }}
                >
                  &nbsp;
                </td>
              </tr>
            </tbody>
          </table>

          <Section
            style={{ padding: '22px 32px 18px', borderBottom: `1px solid ${COLORS.border}` }}
          >
            <table cellPadding={0} cellSpacing={0} role="presentation" style={{ width: '100%' }}>
              <tbody>
                <tr>
                  <td style={{ verticalAlign: 'middle' }}>
                    <Img
                      src={logoUrl()}
                      width={200}
                      height={44}
                      alt="Jaraa CNC Products"
                      style={{ display: 'block', border: 0, height: 44, width: 200 }}
                    />
                  </td>
                  <td
                    style={{
                      color: COLORS.muted,
                      fontSize: 11,
                      fontWeight: 600,
                      letterSpacing: '0.08em',
                      textAlign: 'right',
                      textTransform: 'uppercase',
                      verticalAlign: 'middle',
                    }}
                  >
                    JTAS
                  </td>
                </tr>
              </tbody>
            </table>
          </Section>

          <Section style={{ padding: '28px 32px 32px' }}>{children}</Section>
        </Container>

        <Container style={{ margin: '0 auto', maxWidth: 600, padding: '18px 32px 0' }}>
          <Text
            style={{
              color: COLORS.muted,
              fontSize: 12,
              lineHeight: '18px',
              margin: 0,
              textAlign: 'center',
            }}
          >
            JTAS — Jaraa Task &amp; Accountability System
            <br />
            Jaraa Global Engineering Pvt Ltd. This is an automated message; all times are India
            Standard Time.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

/** The two-column fact table SDD 5.4 uses in the overdue mails. */
export function FactTable({ rows }: { rows: Array<[string, string | null]> }) {
  return (
    <Section
      style={{
        backgroundColor: COLORS.background,
        border: `1px solid ${COLORS.border}`,
        borderRadius: 10,
        marginTop: 18,
        padding: '6px 18px',
      }}
    >
      <table cellPadding={0} cellSpacing={0} style={{ borderCollapse: 'collapse', width: '100%' }}>
        <tbody>
          {rows
            .filter(([, value]) => value !== null && value !== '')
            .map(([label, value]) => (
              <tr key={label}>
                <td
                  style={{
                    borderBottom: `1px solid ${COLORS.border}`,
                    color: COLORS.muted,
                    fontSize: 14,
                    padding: '10px 12px 10px 0',
                    verticalAlign: 'top',
                    whiteSpace: 'nowrap',
                    width: '38%',
                  }}
                >
                  {label}
                </td>
                <td
                  style={{
                    borderBottom: `1px solid ${COLORS.border}`,
                    color: COLORS.text,
                    fontSize: 14,
                    fontWeight: 600,
                    padding: '10px 0',
                  }}
                >
                  {value}
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    </Section>
  );
}

/** The single call to action each mail ends with (improvement I-14). */
export function ActionButton({ href, label }: { href: string; label: string }) {
  return (
    <Section style={{ marginTop: 24 }}>
      <Link
        href={href}
        style={{
          backgroundColor: COLORS.accent,
          borderRadius: 8,
          color: '#ffffff',
          display: 'inline-block',
          fontSize: 15,
          fontWeight: 600,
          padding: '13px 24px',
          textDecoration: 'none',
        }}
      >
        {label}
      </Link>
    </Section>
  );
}

export function Heading({ children }: { children: React.ReactNode }) {
  return (
    <Text
      style={{
        color: COLORS.text,
        fontSize: 22,
        fontWeight: 700,
        letterSpacing: '-0.01em',
        lineHeight: '28px',
        margin: '0 0 16px',
      }}
    >
      {children}
    </Text>
  );
}

export function Paragraph({ children, muted }: { children: React.ReactNode; muted?: boolean }) {
  return (
    <Text
      style={{
        color: muted ? COLORS.muted : COLORS.text,
        fontSize: 14,
        lineHeight: '22px',
        margin: '0 0 12px',
      }}
    >
      {children}
    </Text>
  );
}
