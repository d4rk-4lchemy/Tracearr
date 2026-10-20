import { useTranslation } from 'react-i18next';
import { PEOPLE_RANKS, type PeopleRank } from '@tracearr/shared';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

const RANK_LABEL_KEYS = {
  plays: 'common:labels.plays',
  hours: 'statsUsers.rank.hours',
  data: 'common:labels.data',
  transcodes: 'statsUsers.rank.transcodes',
  requests: 'statsUsers.rank.requests',
  lastSeen: 'statsUsers.rank.lastSeen',
} as const satisfies Record<PeopleRank, string>;

interface RankBySwitchProps {
  ranks?: readonly PeopleRank[];
  value: PeopleRank;
  onChange: (rank: PeopleRank) => void;
}

export function RankBySwitch({ ranks = PEOPLE_RANKS, value, onChange }: RankBySwitchProps) {
  const { t } = useTranslation(['pages', 'common']);

  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      value={value}
      onValueChange={(next) => {
        const rank = ranks.find((candidate) => candidate === next);
        if (rank) onChange(rank);
      }}
      aria-label={t('statsUsers.rankBy')}
    >
      {ranks.map((rank) => (
        <ToggleGroupItem key={rank} value={rank}>
          {t(RANK_LABEL_KEYS[rank])}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
