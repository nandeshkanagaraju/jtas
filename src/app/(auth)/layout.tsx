import { LocalizedElement } from '@/lib/i18n/provider';

import { T } from '@/lib/i18n/provider';
import { ArrowDownRight, ArrowUpRight, ShieldCheck } from 'lucide-react';
import { LanguageSelector } from '@/lib/i18n/provider';
import { Brand } from '@/components/shared/brand';
import { ThemeToggle } from '@/components/shared/theme';
import { PhoneAppMain } from '@/components/shared/phone-app';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <PhoneAppMain className="grid min-h-dvh lg:grid-cols-[.9fr_1.1fr]">
      <section className="phone-auth-form bg-card relative flex min-w-0 flex-col px-6 py-8 sm:px-12 lg:px-16">
        <div className="flex items-center justify-between gap-4">
          <Brand />
          <div className="flex items-center gap-2">
            <LanguageSelector compact />
            <ThemeToggle compact />
          </div>
        </div>
        <div className="phone-auth-fields mx-auto my-auto w-full max-w-[25rem] py-16">
          {children}
          <p className="text-muted-foreground mt-8 flex items-center justify-center gap-2 text-xs">
            <ShieldCheck className="size-3.5" />{' '}
            <T>{' Secure access for Jaraa Global Engineering '}</T>
          </p>
        </div>
        <p className="text-muted-foreground text-center font-mono text-[10px]">
          <T>{'JTAS / Task & accountability system '}</T>
        </p>
      </section>
      <LocalizedElement
        as="section"
        className="relative hidden overflow-hidden bg-[#252e26] p-14 text-[#f3f2e9] lg:flex lg:flex-col xl:p-20"
        aria-label="About Jaraa operations"
      >
        <div className="flex items-center justify-between border-b border-[#4c5944] pb-5 font-mono text-[11px] text-[#c5cdbb]">
          <span>
            <T>{'Built for the shop floor'}</T>
          </span>
          <ArrowUpRight className="size-4" />
        </div>
        <h2 className="mt-16 max-w-lg text-[clamp(3rem,4.6vw,5rem)] leading-[1.02] font-medium tracking-[-0.06em]">
          <T>{'Keep the '}</T>
          <br />
          <T>{'work '}</T>
          <span className="text-[#efc4a7]">
            <T>{'moving.'}</T>
          </span>
        </h2>
        <p className="mt-6 max-w-sm text-base leading-relaxed text-[#c5cdbb]">
          <T>
            {
              'From the first drawing to the final dispatch. One place to connect your people, production and decisions. '
            }
          </T>
        </p>
        <LocalizedElement
          as="div"
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
                <p className="mt-8 max-w-[9rem] text-xl leading-tight tracking-tight">
                  <T>{label}</T>
                </p>
              </div>
            ),
          )}
        </LocalizedElement>
        <div className="mt-auto flex items-center justify-between gap-6 pt-16 text-xs text-[#c5cdbb]">
          <span>
            <T>{'Precision is a team effort.'}</T>
          </span>
          <span className="font-mono">
            <T>{'Jaraa Global /'}</T>
          </span>
        </div>
      </LocalizedElement>
    </PhoneAppMain>
  );
}
