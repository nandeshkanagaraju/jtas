import { ArrowDownRight, ArrowUpRight, ShieldCheck } from 'lucide-react';
import { Brand } from '@/components/shared/brand';
import { ThemeToggle } from '@/components/shared/theme';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-dvh lg:grid-cols-[.9fr_1.1fr]">
      <section className="bg-card relative flex min-w-0 flex-col px-6 py-8 sm:px-12 lg:px-16">
        <div className="flex items-center justify-between gap-4">
          <Brand />
          <ThemeToggle compact />
        </div>
        <div className="mx-auto my-auto w-full max-w-[25rem] py-16">
          {children}
          <p className="text-muted-foreground mt-8 flex items-center justify-center gap-2 text-xs">
            <ShieldCheck className="size-3.5" /> Secure access for Jaraa Global Engineering
          </p>
        </div>
        <p className="text-muted-foreground text-center font-mono text-[10px]">
          JTAS / Task & accountability system
        </p>
      </section>
      <section
        className="relative hidden overflow-hidden bg-[#252e26] p-14 text-[#f3f2e9] lg:flex lg:flex-col xl:p-20"
        aria-label="About Jaraa operations"
      >
        <div className="flex items-center justify-between border-b border-[#4c5944] pb-5 font-mono text-[11px] text-[#c5cdbb]">
          <span>Built for the shop floor</span>
          <ArrowUpRight className="size-4" />
        </div>
        <h2 className="mt-16 max-w-lg text-[clamp(3rem,4.6vw,5rem)] leading-[1.02] font-medium tracking-[-0.06em]">
          Keep the
          <br />
          work <span className="text-[#efc4a7]">moving.</span>
        </h2>
        <p className="mt-6 max-w-sm text-base leading-relaxed text-[#c5cdbb]">
          From the first drawing to the final dispatch. One place to connect your people, production
          and decisions.
        </p>
        <div
          className="relative mt-14 grid grid-cols-2 gap-4 xl:gap-6"
          aria-label="Production workflow"
        >
          {['Plan the job', 'Assign ownership', 'Track the handoff', 'Deliver with confidence'].map(
            (label, index) => (
              <div
                key={label}
                className="min-w-0 rounded-xl border border-[#4c5944] bg-[#2f392e] p-5"
              >
                <div className="flex items-center justify-between font-mono text-xs text-[#becbb4]">
                  <span>0{index + 1}</span>
                  <ArrowDownRight className="size-4" />
                </div>
                <p className="mt-8 max-w-[9rem] text-xl leading-tight tracking-tight">{label}</p>
              </div>
            ),
          )}
        </div>
        <div className="mt-auto flex items-center justify-between gap-6 pt-16 text-xs text-[#c5cdbb]">
          <span>Precision is a team effort.</span>
          <span className="font-mono">Jaraa Global /</span>
        </div>
      </section>
    </main>
  );
}
