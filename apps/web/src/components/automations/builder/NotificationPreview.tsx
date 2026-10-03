import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DESTINATION_TEXT_PROFILES,
  DESTINATION_TYPES,
  SEND_BODY_MAX,
  SEND_TITLE_MAX,
  VARIABLE_SAMPLES,
  escapeFor,
  renderText,
  resolveVariable,
  type DestinationKind,
  type DestinationTextProfile,
  type NotificationPriority,
} from '@tracearr/shared';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useDestinations } from '@/hooks/queries/useDestinations';
import { DiscordPreview } from './preview/DiscordPreview';
import { EmailPreview } from './preview/EmailPreview';
import { fieldData, type FieldData } from './preview/fieldData';
import { PreviewPanel } from './preview/PreviewPanel';
import { PushPreview } from './preview/PushPreview';
import { ToastPreview } from './preview/ToastPreview';
import { WebhookPreview } from './preview/WebhookPreview';

interface NotificationPreviewProps {
  title?: string;
  body?: string;
  to: readonly string[];
  priority?: NotificationPriority;
}

const PLAIN: DestinationTextProfile = {
  escape: 'none',
  title: { max: SEND_TITLE_MAX, unit: 'chars' },
  body: { max: SEND_BODY_MAX, unit: 'chars' },
};

const PRIORITY_KINDS: readonly DestinationKind[] = ['pushover', 'gotify', 'ntfy'];

const samples: Record<string, string> = VARIABLE_SAMPLES;
const lookup = (name: string) => samples[resolveVariable(name)];

interface PanelProps {
  kind: DestinationKind;
  label: string;
  title: FieldData;
  message: FieldData;
  priority?: NotificationPriority;
}

function Panel({ kind, label, title, message, priority }: PanelProps) {
  const { t } = useTranslation('pages');
  switch (kind) {
    case 'discord':
      return <DiscordPreview title={title} message={message} />;
    case 'email':
      return <EmailPreview title={title} message={message} />;
    case 'push':
      return <PushPreview title={title} message={message} />;
    case 'web_toast':
      return <ToastPreview title={title} message={message} />;
    case 'json_webhook':
      return <WebhookPreview title={title} message={message} />;
    default:
      return (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">{label}</span>
            {PRIORITY_KINDS.includes(kind) && (
              <Badge variant="outline">
                {t('automations.message.previewPriority', {
                  priority: t(`automations.priorities.${priority ?? 'automatic'}`),
                })}
              </Badge>
            )}
          </div>
          <PreviewPanel title={title} message={message} />
        </div>
      );
  }
}

/** The text as it would arrive, rendered from sample values in the browser. */
export function NotificationPreview({ title, body, to, priority }: NotificationPreviewProps) {
  const { t } = useTranslation('pages');
  const headingId = useId();
  const { data: destinations } = useDestinations();
  const [picked, setPicked] = useState<string>();
  const kinds = [
    ...new Set(
      (destinations ?? [])
        .filter((destination) => to.includes(destination.id))
        .map((destination) => destination.type)
    ),
  ];
  const tabs = kinds.map((kind) => ({
    kind,
    label: t(`settings.destinations.types.${DESTINATION_TYPES[kind].label}`),
    profile: DESTINATION_TEXT_PROFILES[kind],
  }));
  const active = tabs.some((tab) => tab.kind === picked) ? picked : tabs[0]?.kind;

  const fields = (profile: DestinationTextProfile) => {
    const escape = escapeFor(profile);
    const sent = (text: string | undefined) =>
      text === undefined ? '' : renderText(text, lookup, escape);
    return {
      title: fieldData(sent(title), profile, profile.title),
      message: fieldData(sent(body), profile, profile.body),
    };
  };

  return (
    <section aria-labelledby={headingId} className="space-y-2">
      <div>
        <h3 id={headingId} className="text-muted-foreground text-xs font-medium">
          {t('automations.message.preview')}
        </h3>
        <p className="text-muted-foreground text-xs">
          {t('automations.message.previewSamples', { user: samples['user.username'] })}
        </p>
      </div>
      {tabs.length === 0 ? (
        <>
          <div className="bg-muted/40 rounded-md border p-3">
            <PreviewPanel {...fields(PLAIN)} />
          </div>
          <p className="text-muted-foreground text-xs">
            {t('automations.message.previewPickDestination')}
          </p>
        </>
      ) : (
        <Tabs value={active} onValueChange={setPicked}>
          <TabsList>
            {tabs.map((tab) => (
              <TabsTrigger key={tab.kind} value={tab.kind}>
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
          {tabs.map((tab) => (
            <TabsContent
              key={tab.kind}
              value={tab.kind}
              className="bg-muted/40 rounded-md border p-3"
            >
              <Panel
                kind={tab.kind}
                label={tab.label}
                priority={priority}
                {...fields(tab.profile)}
              />
            </TabsContent>
          ))}
        </Tabs>
      )}
    </section>
  );
}
