import type { ReactNode } from 'react';
import type { Server } from '@tracearr/shared';
import { cn } from '@/lib/utils';
import { ServerBadge } from './ServerBadge';

interface PerServerCardGridProps {
  servers: Server[];
  renderServer: (server: Server) => ReactNode;
  className?: string;
}

export function PerServerCardGrid({ servers, renderServer, className }: PerServerCardGridProps) {
  if (servers.length === 0) return null;

  return (
    <div
      className={cn(
        'grid gap-4',
        servers.length === 1 && 'grid-cols-1',
        servers.length === 2 && 'grid-cols-1 md:grid-cols-2',
        servers.length >= 3 && 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3',
        className
      )}
    >
      {servers.map((server) => (
        <div key={server.id} className="bg-card rounded-xl border p-4">
          <div className="mb-3">
            <ServerBadge server={server} />
          </div>
          {renderServer(server)}
        </div>
      ))}
    </div>
  );
}
