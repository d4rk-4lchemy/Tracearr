import type { ParseKeys } from 'i18next';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { withRangeParams } from '@/lib/rangeParams';
import type { PeopleRank } from '@tracearr/shared';

interface PeopleLinkProps {
  rank: PeopleRank;
  titleKey: ParseKeys<'pages'>;
  descriptionKey: ParseKeys<'pages'>;
}

export function OpenPeopleButton({ href }: { href: string }) {
  const { t } = useTranslation('pages');
  return (
    <Button asChild variant="outline" size="sm">
      <Link to={href}>
        {t('statsUsers.openPeople')}
        <ArrowRight />
      </Link>
    </Button>
  );
}

export function PeopleLink({ rank, titleKey, descriptionKey }: PeopleLinkProps) {
  const { t } = useTranslation('pages');
  const { search } = useLocation();

  return (
    <Card className="py-4">
      <CardContent className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm">
          <span className="font-medium">{t(titleKey)}</span>
          <span className="text-muted-foreground"> {t(descriptionKey)}</span>
        </p>
        <OpenPeopleButton href={withRangeParams(`/stats/people?rank=${rank}`, search)} />
      </CardContent>
    </Card>
  );
}
