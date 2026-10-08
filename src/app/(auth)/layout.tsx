import { Brand } from '@/components/shared/brand';
import { ThemeToggle } from '@/components/shared/theme';

/**
 * Shell for the two unauthenticated screens. Mobile-first: a single centred
 * column that stays comfortable on a phone held on the shop floor.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="bg-background relative flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-sm space-y-6">
        <Brand />
        {children}
        <p className="text-muted-foreground text-center text-xs">
          An internal system for Jaraa Global Engineering. Sessions are recorded in the audit log.
        </p>
      </div>
    </main>
  );
}
