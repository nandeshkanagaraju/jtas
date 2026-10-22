/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { JobForm } from '@/app/(app)/jobs/components/job-form';

afterEach(cleanup);
it('does not accept job edits before the form can preserve their values', () => {
  const markup = renderToString(
    <JobForm submitLabel="Save draft and continue" onSubmit={vi.fn()} />,
  );
  const document = new DOMParser().parseFromString(markup, 'text/html');
  expect(document.querySelector('input[name="title"]')?.hasAttribute('disabled')).toBe(true);
  render(<JobForm submitLabel="Save draft and continue" onSubmit={vi.fn()} />);
  expect((screen.getByRole('textbox', { name: 'Job title' }) as HTMLInputElement).disabled).toBe(
    false,
  );
});
