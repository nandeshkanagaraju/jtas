import { T } from '@/lib/i18n/provider';
import Link from 'next/link';
import { LockKeyhole } from 'lucide-react';
import { SystemState } from '@/components/shared/system-state';
import { Button } from '@/components/ui/button';

export default function Forbidden() {
  return (
    <SystemState
      code="Error 403"
      icon={LockKeyhole}
      title="You do not have access to this page"
      description="Your account does not have permission for this area. If you think that is wrong, ask the Managing Director or the system administrator."
    >
      <Button asChild>
        <Link href="/">
          <T>{'Go to my home page'}</T>
        </Link>
      </Button>
    </SystemState>
  );
}
