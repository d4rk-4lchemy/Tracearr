import { useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Film, Music } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TopListChart } from '@/components/charts';
import { EmptyState } from '@/components/ui/empty-state';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { PerServerCardGrid } from '@/components/server';
import { useLibraryCodecs } from '@/hooks/queries';
import { formatMediaTech, type CodecBreakdown, type CodecEntry } from '@tracearr/shared';
import { browseHref } from '@/lib/browseLinks';
import type { Server } from '@tracearr/shared';

interface CodecDistributionSectionProps {
  serverId?: string | null;
  selectedServers?: Server[];
  isMultiServer?: boolean;
}

/**
 * Convert CodecBreakdown to TopListChart format
 */
function toChartData(breakdown: CodecBreakdown | undefined) {
  if (!breakdown?.codecs) return undefined;
  return breakdown.codecs.map((item) => ({
    name: formatMediaTech(item.codec),
    value: item.count,
    subtitle: item.includes
      ? `${item.percentage}% · ${item.includes.map(formatMediaTech).join(', ')}`
      : `${item.percentage}%`,
  }));
}

const BROWSE_PARAM = {
  video: 'videoCodec',
  audio: 'audioCodec',
  channels: 'audioChannels',
} as const;

/** A codec chart whose bars open Browse filtered to that codec, as movies or TV shows. */
function BrowsableCodecChart({
  kind,
  breakdown,
  isLoading,
  serverId,
}: {
  kind: keyof typeof BROWSE_PARAM;
  breakdown: CodecBreakdown | undefined;
  isLoading: boolean;
  serverId: string | null | undefined;
}) {
  const { t } = useTranslation('pages');
  const [menu, setMenu] = useState<{ entry: CodecEntry; x: number; y: number } | null>(null);
  const entries = breakdown?.codecs ?? [];

  return (
    <div className="relative">
      <TopListChart
        data={toChartData(breakdown)}
        isLoading={isLoading}
        height={220}
        valueLabel="Items"
        colorful
        onItemClick={(index, point) => {
          const entry = entries[index];
          if (entry) setMenu({ entry, ...point });
        }}
        isItemClickable={(index) => entries[index]?.codec !== 'Other'}
      />
      <DropdownMenu open={menu !== null} onOpenChange={(open) => !open && setMenu(null)}>
        <DropdownMenuTrigger asChild>
          <span
            aria-hidden
            className="pointer-events-none absolute size-0"
            style={{ left: menu?.x ?? 0, top: menu?.y ?? 0 }}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {menu && (
            <>
              <DropdownMenuLabel>{formatMediaTech(menu.entry.codec)}</DropdownMenuLabel>
              {menu.entry.movies !== 0 && (
                <DropdownMenuItem asChild>
                  <Link
                    to={browseHref('movie', { [BROWSE_PARAM[kind]]: menu.entry.codec, serverId })}
                  >
                    {t('library.quality.codecBrowse.movies')}
                    {menu.entry.movies !== undefined && (
                      <span className="text-muted-foreground ml-auto pl-4 tabular-nums">
                        {t('library.quality.codecBrowse.movieCount', { count: menu.entry.movies })}
                      </span>
                    )}
                  </Link>
                </DropdownMenuItem>
              )}
              {menu.entry.episodes !== 0 && (
                <DropdownMenuItem asChild>
                  <Link
                    to={browseHref('show', { [BROWSE_PARAM[kind]]: menu.entry.codec, serverId })}
                  >
                    {t('library.quality.codecBrowse.shows')}
                    {menu.entry.episodes !== undefined && (
                      <span className="text-muted-foreground ml-auto pl-4 tabular-nums">
                        {t('library.quality.codecBrowse.episodeCount', {
                          count: menu.entry.episodes,
                        })}
                      </span>
                    )}
                  </Link>
                </DropdownMenuItem>
              )}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** Codec tabs content - shared by both single-server and per-server card renderers. */
function CodecTabsContent({ serverId }: { serverId: string | null | undefined }) {
  const [activeTab, setActiveTab] = useState<'video' | 'music'>('video');
  const codecs = useLibraryCodecs(serverId);

  const musicData = toChartData(codecs.data?.music);

  const hasVideoData = (codecs.data?.video.total ?? 0) > 0;
  const hasMusicData = (codecs.data?.music.total ?? 0) > 0;

  return (
    <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'video' | 'music')}>
      <TabsList className="mb-4">
        <TabsTrigger value="video" className="gap-2">
          <Film className="h-4 w-4" />
          Movies / TV
          {codecs.data?.video.total !== undefined && (
            <span className="text-muted-foreground ml-1">
              ({codecs.data.video.total.toLocaleString()})
            </span>
          )}
        </TabsTrigger>
        <TabsTrigger value="music" className="gap-2">
          <Music className="h-4 w-4" />
          Music
          {codecs.data?.music.total !== undefined && (
            <span className="text-muted-foreground ml-1">
              ({codecs.data.music.total.toLocaleString()})
            </span>
          )}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="video">
        {!codecs.isLoading && !hasVideoData ? (
          <EmptyState
            icon={Film}
            title="No video content"
            description="Video codec data will appear once movies or TV shows are in your library."
          />
        ) : (
          <div className="grid gap-6 md:grid-cols-3">
            <div>
              <h4 className="mb-3 text-sm font-medium">Video Codecs</h4>
              <BrowsableCodecChart
                kind="video"
                breakdown={codecs.data?.video}
                isLoading={codecs.isLoading}
                serverId={serverId}
              />
            </div>
            <div>
              <h4 className="mb-3 text-sm font-medium">Audio Codecs</h4>
              <BrowsableCodecChart
                kind="audio"
                breakdown={codecs.data?.audio}
                isLoading={codecs.isLoading}
                serverId={serverId}
              />
            </div>
            <div>
              <h4 className="mb-3 text-sm font-medium">Audio Channels</h4>
              <BrowsableCodecChart
                kind="channels"
                breakdown={codecs.data?.channels}
                isLoading={codecs.isLoading}
                serverId={serverId}
              />
            </div>
          </div>
        )}
      </TabsContent>

      <TabsContent value="music">
        {!codecs.isLoading && !hasMusicData ? (
          <EmptyState
            icon={Music}
            title="No music content"
            description="Music codec data will appear once music tracks are in your library."
          />
        ) : (
          <div>
            <h4 className="mb-3 text-sm font-medium">Audio Codecs</h4>
            <TopListChart
              data={musicData}
              isLoading={codecs.isLoading}
              height={280}
              valueLabel="Tracks"
              colorful
            />
          </div>
        )}
      </TabsContent>
    </Tabs>
  );
}

/** Per-server codec content rendered inside PerServerCardGrid (no outer Card). */
function ServerCodecCard({ serverId }: { serverId: string }) {
  return <CodecTabsContent serverId={serverId} />;
}

/**
 * Codec Distribution Section
 *
 * Single-server: full-width card with video/music tabs as today.
 * Multi-server: one PerServerCardGrid card per server; each card has its own codec tabs.
 */
export function CodecDistributionSection({
  serverId,
  selectedServers,
  isMultiServer,
}: CodecDistributionSectionProps) {
  if (isMultiServer && selectedServers && selectedServers.length > 0) {
    return (
      <PerServerCardGrid
        servers={selectedServers}
        renderServer={(server) => <ServerCodecCard serverId={server.id} />}
      />
    );
  }

  // Single-server path - unchanged layout
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-medium">Codec Distribution</CardTitle>
      </CardHeader>
      <CardContent>
        <CodecTabsContent serverId={serverId} />
      </CardContent>
    </Card>
  );
}
