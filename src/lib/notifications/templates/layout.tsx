/**
 * The shell every JTAS mail shares — SDD section 5.4.
 *
 * Deliberately plain: tables and inline styles, no external CSS, no images.
 * These mails are read on Gmail mobile on a shop floor and in Outlook web in an
 * office, and the ones that render everywhere are the ones that look like 1998.
 */
import {
  Body,
  Container,
  Head,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from '@react-email/components';

export const COLORS = {
  text: '#0f172a',
  muted: '#64748b',
  border: '#e2e8f0',
  background: '#f8fafc',
  accent: '#0f172a',
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
      <Body style={{ backgroundColor: COLORS.background, fontFamily: FONT, margin: 0, padding: 0 }}>
        <Container
          style={{
            backgroundColor: '#ffffff',
            border: `1px solid ${COLORS.border}`,
            borderRadius: 8,
            margin: '24px auto',
            maxWidth: 600,
            padding: 24,
          }}
        >
          {children}

          <Hr style={{ borderColor: COLORS.border, margin: '24px 0 12px' }} />

          <Text style={{ color: COLORS.muted, fontSize: 12, lineHeight: '18px', margin: 0 }}>
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
    <Section style={{ marginTop: 16 }}>
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
                    padding: '8px 12px 8px 0',
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
                    fontWeight: 500,
                    padding: '8px 0',
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
    <Section style={{ marginTop: 20 }}>
      <Link
        href={href}
        style={{
          backgroundColor: COLORS.accent,
          borderRadius: 6,
          color: '#ffffff',
          display: 'inline-block',
          fontSize: 14,
          fontWeight: 600,
          padding: '11px 20px',
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
    <Text style={{ color: COLORS.text, fontSize: 18, fontWeight: 600, margin: '0 0 8px' }}>
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
