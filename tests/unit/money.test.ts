import { describe, expect, it } from 'vitest';

import { formatGstPercent, formatRupees, invoiceAmounts } from '@/lib/domain/money';
import { addInvoiceSchema } from '@/lib/validation/invoice';

describe('invoice money', () => {
  it('works in paise with GST rounded to the nearest paisa', () => {
    expect(invoiceAmounts(22, 125050, 1800)).toEqual({
      taxablePaise: 2751100,
      gstPaise: 495198,
      totalPaise: 3246298,
    });
    expect(invoiceAmounts(3, 333, 1800).gstPaise).toBe(180); // 179.82 → 180
    expect(invoiceAmounts(5, 1000, 0)).toEqual({
      taxablePaise: 5000,
      gstPaise: 0,
      totalPaise: 5000,
    });
  });

  it('formats rupees with Indian grouping', () => {
    expect(formatRupees(3246298)).toBe('₹32,462.98');
    expect(formatRupees(1234567890)).toBe('₹1,23,45,678.90');
    expect(formatGstPercent(1250)).toBe('12.5');
  });

  it('parses the form into paise and basis points', () => {
    expect(
      addInvoiceSchema.parse({
        invoiceNumber: ' INV-001 ',
        invoiceDate: '2026-11-25',
        quantity: '22',
        rate: '1,250.50',
        gstPercent: '18',
        note: '',
      }),
    ).toEqual({
      billType: 'SALES',
      invoiceNumber: 'INV-001',
      invoiceDate: '2026-11-25',
      quantity: 22,
      rate: 125050,
      gstPercent: 1800,
      note: undefined,
    });
  });

  it('refuses bad input', () => {
    const base = {
      invoiceNumber: 'A',
      invoiceDate: '2026-11-25',
      quantity: 1,
      rate: '10',
      gstPercent: '18',
    };
    expect(addInvoiceSchema.safeParse({ ...base, rate: '10.555' }).success).toBe(false);
    expect(addInvoiceSchema.safeParse({ ...base, rate: '-1' }).success).toBe(false);
    expect(addInvoiceSchema.safeParse({ ...base, gstPercent: '101' }).success).toBe(false);
    expect(addInvoiceSchema.safeParse({ ...base, quantity: 0 }).success).toBe(false);
    expect(addInvoiceSchema.safeParse({ ...base, invoiceDate: '25/11/2026' }).success).toBe(false);
    expect(addInvoiceSchema.safeParse({ ...base, invoiceNumber: '  ' }).success).toBe(false);
  });
});
