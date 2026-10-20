import { Film } from 'lucide-react';
import { imageProxyUrl } from '@/lib/api';

/** A 2:3 poster at list-row size, with a film glyph when the title has no art. */
export function PosterThumb({
  serverId,
  thumbPath,
}: {
  serverId: string;
  thumbPath: string | null;
}) {
  return (
    <div className="bg-muted flex h-12 w-8 shrink-0 items-center justify-center overflow-hidden rounded-sm">
      {thumbPath ? (
        <img
          src={imageProxyUrl(serverId, thumbPath, 64, 96, 'poster')}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover"
        />
      ) : (
        <Film className="text-muted-foreground size-4" />
      )}
    </div>
  );
}
