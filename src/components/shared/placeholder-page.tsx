import { Hammer } from 'lucide-react';

import { PageHeader } from '@/components/shared/page-header';
import { Panel } from '@/components/shared/panel';
import { EmptyState } from '@/components/shared/states';

/**
 * Stands in for a screen whose module has not been built yet, naming the module
 * that will fill it so the gap is obvious rather than looking like a bug.
 */
export function PlaceholderPage({
  title,
  description,
  module,
}: {
  title: string;
  description: string;
  module: string;
}) {
  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Not built yet" title={title} lead={description} />

      <Panel flush>
        <EmptyState
          icon={Hammer}
          title={`Coming in ${module}`}
          description="Authentication and access control for this screen are already live — only the content is still to be built. You are seeing it because your role has permission to open it."
        />
      </Panel>
    </div>
  );
}
