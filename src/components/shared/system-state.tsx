import { T } from '@/lib/i18n/provider';
import type { LucideIcon } from 'lucide-react';
import { Brand } from '@/components/shared/brand';

export function SystemState({
  code,
  title,
  description,
  icon: Icon,
  children,
}: {
  code: string;
  title: string;
  description: React.ReactNode;
  icon: LucideIcon;
  children?: React.ReactNode;
}) {
  return (
    <main className="app-canvas bg-background flex min-h-dvh flex-col items-center justify-center px-5 py-16">
      <Brand className="mb-12" />
      <div className="product-panel border-border bg-card w-full max-w-xl rounded-2xl border p-7 text-center sm:p-12">
        <span className="border-border bg-muted text-action mx-auto flex size-16 items-center justify-center rounded-2xl border">
          <Icon className="size-7" strokeWidth={1.5} aria-hidden />
        </span>
        <p className="eyebrow mt-7">{code}</p>
        <h1 className="page-title mt-3 text-balance">
          <T>{title}</T>
        </h1>
        <div className="text-muted-foreground mt-4 text-sm leading-relaxed">
          <T>{description}</T>
        </div>
        {children ? (
          <div className="mt-7 flex flex-wrap justify-center gap-3">{children}</div>
        ) : null}
      </div>
    </main>
  );
}
