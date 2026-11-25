'use client';

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { toast } from 'sonner';

import { ApiError } from '@/lib/api/client';
import type { PartDto, ReportDto } from '@/lib/services/production/reports';

interface ReportState {
  report: ReportDto;
  parts: PartDto[];
  busy: boolean;
  setParts: (parts: PartDto[]) => void;
  /**
   * Runs a call that returns the whole report, and shows it. Returns false
   * (after a toast) when the server refused.
   */
  run: (call: () => Promise<ReportDto>, success?: string) => Promise<boolean>;
}

const ReportContext = createContext<ReportState | null>(null);

export function ReportProvider({
  initial,
  initialParts,
  children,
}: {
  initial: ReportDto;
  initialParts: PartDto[];
  children: ReactNode;
}) {
  const [report, setReport] = useState(initial);
  const [parts, setParts] = useState(initialParts);
  const [busy, setBusy] = useState(false);

  const run = useCallback(async (call: () => Promise<ReportDto>, success?: string) => {
    setBusy(true);
    try {
      setReport(await call());
      if (success) toast.success(success);
      return true;
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Could not reach the server.');
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <ReportContext.Provider value={{ report, parts, busy, setParts, run }}>
      {children}
    </ReportContext.Provider>
  );
}

export function useReport(): ReportState {
  const value = useContext(ReportContext);
  if (!value) throw new Error('useReport outside ReportProvider');
  return value;
}

export function messageOf(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Could not reach the server.';
}
