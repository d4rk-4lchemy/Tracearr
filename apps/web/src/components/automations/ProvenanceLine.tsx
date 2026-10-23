import { useTranslation } from 'react-i18next';
import type { Automation } from '@tracearr/shared';
import { templateName } from '@/lib/automations';
import { formatDate } from '@/lib/dateFormat';

/** Where an automation came from: the template behind it, or the one it left. */
export function ProvenanceLine({ automation }: { automation: Automation }) {
  const { t } = useTranslation('pages');
  const { template, origin } = automation;

  if (template) {
    const name = templateName(t, { slug: template.slug, name: template.name });
    const version = t('automations.template.version', { version: template.version });

    if (template.source === 'builtin') {
      return <Line>{t('automations.provenance.builtin', { name, version })}</Line>;
    }
    const date = formatDate(new Date(template.addedAt), { dateStyle: 'medium' });

    if (template.source === 'import') {
      return (
        <Line>
          {template.author
            ? t('automations.provenance.importedBy', {
                name,
                version,
                date,
                author: template.author,
              })
            : t('automations.provenance.imported', { name, version, date })}
        </Line>
      );
    }
    return <Line>{t('automations.provenance.saved', { name, version, date })}</Line>;
  }

  if (!origin) return null;

  return (
    <Line>
      {origin.name
        ? t('automations.provenance.customized', { name: origin.name })
        : t('automations.provenance.customizedFromRemoved')}
    </Line>
  );
}

function Line({ children }: { children: React.ReactNode }) {
  return <p className="text-muted-foreground text-xs">{children}</p>;
}
