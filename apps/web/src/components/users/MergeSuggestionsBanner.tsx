import { useTranslation } from 'react-i18next';
import { Users as UsersIcon } from 'lucide-react';
import type { MergeSuggestion } from '@tracearr/shared';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useMergeSuggestions } from '@/hooks/queries';

interface MergeSuggestionsBannerProps {
  onReview: (suggestion: MergeSuggestion) => void;
}

const HEADING_ID = 'merge-suggestions-heading';

export function MergeSuggestionsBanner({ onReview }: MergeSuggestionsBannerProps) {
  const { t } = useTranslation(['pages']);
  const { data, isLoading, isError } = useMergeSuggestions(true);

  if (isLoading) return null;
  if (isError) {
    return <p className="text-muted-foreground text-sm">{t('pages:users.suggestionsError')}</p>;
  }
  if (!data || data.length === 0) return null;

  return (
    <Card role="region" aria-labelledby={HEADING_ID}>
      <CardHeader>
        <CardTitle id={HEADING_ID} className="flex items-center gap-2 text-base">
          <UsersIcon className="h-4 w-4" aria-hidden="true" />
          {t('pages:users.suggestionsTitle')}
        </CardTitle>
        <CardDescription>{t('pages:users.suggestionsDescription')}</CardDescription>
      </CardHeader>
      <CardContent>
        <ul aria-labelledby={HEADING_ID} className="list-none space-y-2" role="list">
          {data.map((suggestion) => {
            const [firstUser, secondUser] = suggestion.users;
            return (
              <li
                key={`${firstUser.userId}:${secondUser.userId}`}
                role="listitem"
                className="flex items-center justify-between gap-4 rounded-md border p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">
                    {suggestion.matchType === 'email'
                      ? t('pages:users.suggestionsMatchEmail')
                      : t('pages:users.suggestionsMatchUsername')}
                  </Badge>
                  <span className="font-medium">{suggestion.matchValue}</span>
                  <span className="flex flex-wrap gap-1">
                    {[firstUser, secondUser].flatMap((identity) =>
                      identity.serverUsers.map((serverUser) => (
                        <Badge
                          key={serverUser.id}
                          variant="secondary"
                          className={cn(
                            'gap-1 font-normal',
                            serverUser.removedAt && 'text-muted-foreground'
                          )}
                        >
                          {serverUser.serverName}
                          {serverUser.removedAt && (
                            <span>{t('pages:users.mergeServerAccountRemoved')}</span>
                          )}
                        </Badge>
                      ))
                    )}
                  </span>
                </div>
                <Button size="sm" variant="outline" onClick={() => onReview(suggestion)}>
                  {t('pages:users.suggestionsReview')}
                </Button>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
