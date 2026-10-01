import { Brand } from '@/components/shared/brand';

/**
 * Shell for the two unauthenticated screens. Mobile-first: a single centred
 * column that stays comfortable on a phone held on the shop floor.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="bg-background flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm space-y-6">
        <Brand />
        {children}
      </div>
    </main>
  );
}
