import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Tv } from 'lucide-react';
import type { ActiveSession } from '@tracearr/shared';
import { NowPlayingCard } from '@/components/sessions';
import { SessionDetailSheet } from '@/components/history/SessionDetailSheet';
import { EmptyState } from '@/components/ui/empty-state';
import { NowPlayingCardSkeleton } from '@/components/ui/skeleton';
import { SectionHeading } from './SectionHeading';

interface NowPlayingSectionProps {
  /** Undefined while loading */
  sessions: ActiveSession[] | undefined;
  /** The personal page has no stream to show most of the time, so it shows nothing rather than an empty card */
  hideWhenEmpty?: boolean;
  actions?: ReactNode;
}

export function NowPlayingSection({
  sessions,
  hideWhenEmpty = false,
  actions,
}: NowPlayingSectionProps) {
  const { t } = useTranslation(['pages', 'common']);
  const [selected, setSelected] = useState<ActiveSession | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  if (hideWhenEmpty && (!sessions || sessions.length === 0)) return null;

  return (
    <section>
      <SectionHeading icon={Tv} title={t('dashboard.nowPlaying')} actions={actions}>
        {sessions && sessions.length > 0 && (
          <span className="bg-muted text-foreground rounded-full px-2 py-0.5 text-xs font-medium">
            {t('common:count.stream', { count: sessions.length })}
          </span>
        )}
      </SectionHeading>

      {!sessions ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <NowPlayingCardSkeleton key={i} />
          ))}
        </div>
      ) : sessions.length === 0 ? (
        <EmptyState
          icon={Tv}
          title={t('dashboard.noActiveStreams')}
          description={t('dashboard.streamsAppearHere')}
          className="rounded-xl border border-dashed"
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {sessions.map((session) => (
            <NowPlayingCard
              key={session.id}
              session={session}
              onClick={() => {
                setSelected(session);
                setSheetOpen(true);
              }}
            />
          ))}
        </div>
      )}

      <SessionDetailSheet session={selected} open={sheetOpen} onOpenChange={setSheetOpen} />
    </section>
  );
}
