import { T } from '@/lib/i18n/provider';
import Link from 'next/link';
import { ScanSearch } from 'lucide-react';
import { SystemState } from '@/components/shared/system-state';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <SystemState
      code="Error 404"
      icon={ScanSearch}
      title="That page is not here"
      description="The link may be out of date, or the job may have been cancelled. If somebody sent you this link, ask them for the job code and search for it."
    >
      <Button asChild>
        <Link href="/">
          <T>{'Go to my home page'}</T>
        </Link>
      </Button>
      <Button asChild variant="outline">
        <Link href="/jobs">
          <T>{'Search the jobs'}</T>
        </Link>
      </Button>
    </SystemState>
  );
}
