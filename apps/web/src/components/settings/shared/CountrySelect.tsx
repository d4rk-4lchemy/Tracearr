import { useTranslation } from 'react-i18next';
import { getData } from 'country-list';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';

const OPTIONS: ComboboxOption[] = getData()
  .map(({ code, name }) => ({ value: code, label: name }))
  .sort((a, b) => a.label.localeCompare(b.label));

export function CountrySelect({
  value,
  onChange,
  id,
}: {
  value: string;
  onChange: (code: string) => void;
  id?: string;
}) {
  const { t } = useTranslation('settings');
  return (
    <Combobox
      value={value || null}
      onChange={onChange}
      options={OPTIONS}
      placeholder={t('servers.location.countryPlaceholder')}
      searchPlaceholder={t('servers.location.countrySearch')}
      emptyText={t('servers.location.countryEmpty')}
      id={id}
      contentClassName="w-72"
    />
  );
}
