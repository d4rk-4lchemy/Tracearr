import { useTranslation } from 'react-i18next';
import type { Server } from '@tracearr/shared';
import { Badge } from '@/components/ui/badge';
import { liveFirst } from '@/lib/servers';
import { cn } from '@/lib/utils';
import { MediaServerIcon } from '@/components/icons/MediaServerIcon';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface ServerSelectProps {
  servers: Server[];
  value: string;
  onChange: (serverId: string) => void;
  placeholder: string;
  id?: string;
  className?: string;
}

// Matches the navbar picker's treatment (type icon plus the server's colour on
// the left edge) so the two read as the same control in different modes.
export function ServerSelect({
  servers,
  value,
  onChange,
  placeholder,
  id,
  className,
}: ServerSelectProps) {
  const { t } = useTranslation('common');
  const ordered = liveFirst(servers);
  const selected = ordered.find((server) => server.id === value);

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        id={id}
        className={cn('border-l-2', className)}
        style={{ borderLeftColor: selected?.color ?? 'transparent' }}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {ordered.map((server) => (
          <SelectItem key={server.id} value={server.id}>
            <span className="flex min-w-0 items-center gap-2">
              <MediaServerIcon type={server.type} className="h-4 w-4 shrink-0" />
              <span className="truncate">{server.name}</span>
              {server.historicalAt && (
                <Badge variant="outline" className="ml-auto">
                  {t('serverSelector.historical')}
                </Badge>
              )}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
