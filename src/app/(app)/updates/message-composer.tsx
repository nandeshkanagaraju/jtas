'use client';
import { useState } from 'react';
import { Send } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/provider';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { PhoneDisclosure } from '@/components/shared/phone-app';
import { ApiError, apiPost } from '@/lib/api/client';
import type { LiveStage } from '@/lib/live-updates/types';

export function MessageComposer({
  stages,
  preferred,
  draft,
  onDraft,
  onPosted,
}: {
  stages: LiveStage[];
  preferred: string;
  draft: Record<string, string>;
  onDraft: (id: string, value: string) => void;
  onPosted: (id: string) => void;
}) {
  const { t } = useLanguage();
  const [choice, setChoice] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const allowed = stages.filter((stage) => stage.canComment);
  const target =
    allowed.find((stage) => stage.id === choice) ??
    allowed.find((stage) => stage.id === preferred) ??
    allowed[0];
  if (!target) return null;
  const body = draft[target.id] ?? '';
  async function post() {
    if (!target || !body.trim() || busy) return;
    const id = target.id;
    setBusy(true);
    setError('');
    try {
      await apiPost(`/api/subtasks/${id}/comments`, { body: body.trim() });
      onDraft(id, '');
      onPosted(id);
    } catch (failure) {
      setError(
        failure instanceof ApiError
          ? failure.message
          : 'Could not post the update. Your message is still here.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="live-composer">
      <PhoneDisclosure title="Post an update">
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void post();
          }}
        >
          <label className="block space-y-2 text-sm font-medium">
            <span>{t('Message about')}</span>
            <select
              aria-label={t('Message about')}
              className="live-select w-full"
              value={target.id}
              disabled={busy}
              onChange={(event) => {
                setChoice(event.target.value);
                setError('');
              }}
            >
              {allowed.map((stage) => (
                <option key={stage.id} value={stage.id}>
                  {stage.department.name} · {stage.title}
                </option>
              ))}
            </select>
          </label>
          <Textarea
            aria-label={t('Job message')}
            placeholder={t('Share progress, ask a question or explain a delay…')}
            value={body}
            maxLength={2000}
            rows={3}
            disabled={busy}
            onChange={(event) => onDraft(target.id, event.target.value)}
          />
          <p className="text-muted-foreground text-xs">
            {t('Everyone assigned to this job can see this message.')}
          </p>
          {error ? (
            <p role="alert" className="text-late text-sm">
              {t(error)}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-muted-foreground text-xs">{body.length}/2000</span>
            <Button type="submit" disabled={busy || !body.trim()}>
              <Send className="size-4" aria-hidden />
              {t(busy ? 'Posting…' : 'Post message')}
            </Button>
          </div>
        </form>
      </PhoneDisclosure>
    </div>
  );
}
