import { useTranslation } from 'react-i18next';
import { MapPin, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldLabel, FieldTitle } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { LocationPicker } from '@/components/map/LocationPicker';
import { CountrySelect } from '@/components/settings/shared/CountrySelect';
import { coordinate, emptyDraft, todayString, type LocationDraft } from './serverLocationDrafts';

const parsed = (value: string) =>
  value.trim() === '' || !Number.isFinite(Number(value)) ? null : Number(value);

export function ServerLocationEditor({
  drafts,
  onChange,
  syncPending,
  error,
}: {
  drafts: LocationDraft[];
  onChange: (drafts: LocationDraft[]) => void;
  syncPending: boolean;
  error: string | null;
}) {
  const { t } = useTranslation('settings');
  const update = (key: string, patch: Partial<LocationDraft>) =>
    onChange(drafts.map((draft) => (draft.key === key ? { ...draft, ...patch } : draft)));

  return (
    <Field>
      <FieldTitle>{t('servers.location.title')}</FieldTitle>
      <FieldDescription>{t('servers.location.description')}</FieldDescription>

      {drafts.map((draft) => (
        <div key={draft.key} className="space-y-3 rounded-lg border p-3">
          <div className="flex items-center justify-between gap-2">
            {draft.date === null ? (
              <span className="text-sm font-medium">{t('servers.location.fromBeginning')}</span>
            ) : (
              <div className="flex items-center gap-2">
                <FieldLabel htmlFor={`${draft.key}-date`}>
                  {t('servers.location.movedOn')}
                </FieldLabel>
                <Input
                  id={`${draft.key}-date`}
                  type="date"
                  max={todayString()}
                  value={draft.date}
                  onChange={(e) => update(draft.key, { date: e.target.value })}
                  className="w-40"
                />
              </div>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onChange(drafts.filter((d) => d.key !== draft.key))}
            >
              <Trash2 />
              {t('servers.location.remove')}
            </Button>
          </div>

          <LocationPicker
            lat={parsed(draft.lat)}
            lon={parsed(draft.lon)}
            onPick={(lat, lon) => update(draft.key, { lat: coordinate(lat), lon: coordinate(lon) })}
          />
          <FieldDescription>{t('servers.location.pickHint')}</FieldDescription>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <FieldLabel htmlFor={`${draft.key}-lat`}>{t('servers.location.latitude')}</FieldLabel>
              <Input
                id={`${draft.key}-lat`}
                inputMode="decimal"
                value={draft.lat}
                onChange={(e) => update(draft.key, { lat: e.target.value })}
              />
            </div>
            <div>
              <FieldLabel htmlFor={`${draft.key}-lon`}>
                {t('servers.location.longitude')}
              </FieldLabel>
              <Input
                id={`${draft.key}-lon`}
                inputMode="decimal"
                value={draft.lon}
                onChange={(e) => update(draft.key, { lon: e.target.value })}
              />
            </div>
            <div className="col-span-2">
              <FieldLabel htmlFor={`${draft.key}-country`}>
                {t('servers.location.country')}
              </FieldLabel>
              <CountrySelect
                id={`${draft.key}-country`}
                value={draft.country}
                onChange={(country) => update(draft.key, { country })}
              />
            </div>
            <div>
              <FieldLabel htmlFor={`${draft.key}-city`}>{t('servers.location.city')}</FieldLabel>
              <Input
                id={`${draft.key}-city`}
                maxLength={255}
                value={draft.city}
                onChange={(e) => update(draft.key, { city: e.target.value })}
              />
            </div>
            <div>
              <FieldLabel htmlFor={`${draft.key}-region`}>
                {t('servers.location.region')}
              </FieldLabel>
              <Input
                id={`${draft.key}-region`}
                maxLength={255}
                value={draft.region}
                onChange={(e) => update(draft.key, { region: e.target.value })}
              />
            </div>
          </div>
        </div>
      ))}

      <div className="flex gap-2">
        {!drafts.some((draft) => draft.date === null) && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onChange([emptyDraft(null), ...drafts])}
          >
            <MapPin />
            {t('servers.location.set')}
          </Button>
        )}
        {drafts.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onChange([...drafts, emptyDraft(todayString())])}
          >
            <Plus />
            {t('servers.location.addMove')}
          </Button>
        )}
      </div>

      {error && <p className="text-destructive text-sm">{error}</p>}
      {syncPending && <FieldDescription>{t('servers.location.syncPending')}</FieldDescription>}
    </Field>
  );
}
