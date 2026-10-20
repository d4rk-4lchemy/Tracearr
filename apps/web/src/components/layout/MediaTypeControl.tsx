import { useTranslation } from 'react-i18next';
import type { MediaTypeOption } from '@tracearr/shared';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

const LABEL_KEYS = {
  all: 'pages:library.quality.all',
  movie: 'common:media.movie_plural',
  show: 'common:media.tvShows',
  artist: 'common:media.artist_plural',
} as const satisfies Record<MediaTypeOption, string>;

interface MediaTypeControlProps<T extends MediaTypeOption> {
  value: T;
  onChange: (value: T) => void;
  options: readonly T[];
}

export function MediaTypeControl<T extends MediaTypeOption>({
  value,
  onChange,
  options,
}: MediaTypeControlProps<T>) {
  const { t } = useTranslation(['common', 'pages']);

  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={(next) => {
        const picked = options.find((option) => option === next);
        if (picked) onChange(picked);
      }}
      variant="outline"
      aria-label={t('common:labels.type')}
    >
      {options.map((option) => (
        <ToggleGroupItem key={option} value={option}>
          {t(LABEL_KEYS[option])}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
