'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { IstDateTimePicker } from '@/components/shared/ist-datetime-picker';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api/client';
import { createJobSchema, type CreateJobInput, type PriorityValue } from '@/lib/validation/job';

const PRIORITIES: Array<{ value: PriorityValue; label: string }> = [
  { value: 'LOW', label: 'Low' },
  { value: 'NORMAL', label: 'Normal' },
  { value: 'HIGH', label: 'High' },
  { value: 'URGENT', label: 'Urgent' },
];

/**
 * Job details — step 1 of the create wizard, and the edit form.
 *
 * `frozenFields` greys out what the server will refuse on a published job, so
 * the restriction is visible before the user types rather than after they
 * submit. It is presentation only; the service enforces the same rule.
 */
export function JobForm({
  defaultValues,
  frozenFields = [],
  submitLabel,
  onSubmit,
  onCancel,
}: {
  defaultValues?: Partial<CreateJobInput>;
  frozenFields?: readonly string[];
  submitLabel: string;
  onSubmit: (values: CreateJobInput) => Promise<void>;
  onCancel?: () => void;
}) {
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<CreateJobInput>({
    resolver: zodResolver(createJobSchema),
    defaultValues: {
      title: '',
      customerName: undefined,
      partNumber: undefined,
      drawingNumber: undefined,
      quantity: undefined,
      priority: 'NORMAL',
      description: undefined,
      overallDeadline: '',
      ...defaultValues,
    },
  });

  const frozen = new Set(frozenFields);
  const isSubmitting = form.formState.isSubmitting;

  async function handleSubmit(values: CreateJobInput) {
    setFormError(null);
    try {
      await onSubmit(values);
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.fields) {
          for (const [field, messages] of Object.entries(error.fields)) {
            if (field in values) {
              form.setError(field as keyof CreateJobInput, { message: messages[0] });
            }
          }
        }
        setFormError(error.message);
      } else {
        setFormError('Could not reach the server. Check your connection and try again.');
      }
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-5" noValidate>
        {formError ? (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        ) : null}

        <FormField
          control={form.control}
          name="title"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Job title</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  placeholder="Spindle housing batch"
                  disabled={isSubmitting || frozen.has('title')}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="customerName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  Customer <span className="text-muted-foreground font-normal">(optional)</span>
                </FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    value={field.value ?? ''}
                    disabled={isSubmitting || frozen.has('customerName')}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="quantity"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  Quantity <span className="text-muted-foreground font-normal">(optional)</span>
                </FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    value={field.value ?? ''}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    disabled={isSubmitting || frozen.has('quantity')}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="partNumber"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  Part number <span className="text-muted-foreground font-normal">(optional)</span>
                </FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    value={field.value ?? ''}
                    placeholder="SH-4410"
                    disabled={isSubmitting || frozen.has('partNumber')}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="drawingNumber"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  Drawing number{' '}
                  <span className="text-muted-foreground font-normal">(optional)</span>
                </FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    value={field.value ?? ''}
                    placeholder="DRG-4410-B"
                    disabled={isSubmitting || frozen.has('drawingNumber')}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="priority"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Priority</FormLabel>
                <Select
                  value={field.value}
                  onValueChange={field.onChange}
                  disabled={isSubmitting || frozen.has('priority')}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {PRIORITIES.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="overallDeadline"
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor="overallDeadline">Overall deadline</FormLabel>
                <FormControl>
                  <IstDateTimePicker
                    id="overallDeadline"
                    value={field.value}
                    onChange={field.onChange}
                    disabled={isSubmitting || frozen.has('overallDeadline')}
                  />
                </FormControl>
                <FormDescription>
                  India Standard Time. Every subtask deadline sits before this.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                Description <span className="text-muted-foreground font-normal">(optional)</span>
              </FormLabel>
              <FormControl>
                <Textarea
                  {...field}
                  value={field.value ?? ''}
                  rows={3}
                  placeholder="Material, tolerances, anything the shop floor needs to know."
                  disabled={isSubmitting || frozen.has('description')}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex justify-end gap-2">
          {onCancel ? (
            <Button type="button" variant="ghost" onClick={onCancel} disabled={isSubmitting}>
              Cancel
            </Button>
          ) : null}
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? <Loader2 className="size-4 animate-spin" /> : null}
            {submitLabel}
          </Button>
        </div>
      </form>
    </Form>
  );
}
