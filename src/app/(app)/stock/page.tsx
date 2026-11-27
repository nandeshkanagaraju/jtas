import type { Metadata } from 'next';
import { forbidden } from 'next/navigation';

import { PageHeader } from '@/components/shared/page-header';
import { can } from '@/lib/auth/policy';
import { requireActiveSession } from '@/lib/auth/session';
import { T } from '@/lib/i18n/provider';
import { knownParts } from '@/lib/services/shop-reports/stock-ledger';
import { istDateKey } from '@/lib/utils/time';

import { StockScreen } from './stock-screen';

export const metadata: Metadata = { title: 'Stock' };
export const dynamic = 'force-dynamic';

/**
 * Raw material and finished goods in hand per part. Store's register receipts
 * add RM, Production's output moves it to FG, and dispatches take FG away.
 * The MD, the Deputy, the job managers, Store and Production.
 */
export default async function StockPage() {
  const session = await requireActiveSession();
  if (!can(session, 'stock:view', undefined)) forbidden();

  const today = istDateKey(new Date());
  return (
    <div className="w-full space-y-5">
      <PageHeader
        eyebrow={<T>{'Stores'}</T>}
        title={<T>{'Stock'}</T>}
        lead={
          <T>
            {
              'Raw material and finished goods in hand for every part, day by day. RM goes up with each receipt Store records and down with what Production makes or rejects on its job; FG goes up with the accepted pieces and down with each dispatch.'
            }
          </T>
        }
      />
      <StockScreen
        today={today}
        monthStart={`${today.slice(0, 8)}01`}
        parts={await knownParts()}
        currentUserId={session.id}
        permissions={{
          setOpening: can(session, 'stock:setOpening', undefined),
          recordProduced: can(session, 'stock:recordProduced', undefined),
          recordDispatch: can(session, 'stock:recordDispatch', undefined),
          removeAny: session.role === 'MD' || session.role === 'DEPUTY_MD',
        }}
      />
    </div>
  );
}
