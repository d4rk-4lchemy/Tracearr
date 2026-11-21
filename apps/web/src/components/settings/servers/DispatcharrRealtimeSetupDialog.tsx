import { useTranslation } from 'react-i18next';
import { AlertTriangle, ExternalLink } from 'lucide-react';
import type { ServerConnectionStatus } from '@tracearr/shared';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const ISSUE_KEYS = {
  blocked: 'servers.realtimeDialog.issueBlocked',
  restart_required: 'servers.realtimeDialog.issueRestartRequired',
  malfunctioned: 'servers.realtimeDialog.issueMalfunctioned',
} as const;

export function DispatcharrRealtimeSetupDialog({
  open,
  onClose,
  mode = 'setup',
  connectionStatus,
}: {
  open: boolean;
  onClose: () => void;
  mode?: 'setup' | 'update';
  connectionStatus?: ServerConnectionStatus;
}) {
  const { t } = useTranslation(['settings', 'common']);
  const issueKey =
    connectionStatus?.pluginIssue && connectionStatus.pluginIssue in ISSUE_KEYS
      ? ISSUE_KEYS[connectionStatus.pluginIssue as keyof typeof ISSUE_KEYS]
      : null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {mode === 'update'
              ? 'Update the Tracearr SSE Metrics plugin'
              : 'Enable Tracearr SSE Metrics'}
          </DialogTitle>
          <DialogDescription>
            Install the Tracearr SSE Metrics plugin to provide server metrics and plugin version
            information to Tracearr.
          </DialogDescription>
        </DialogHeader>

        <div className="text-muted-foreground space-y-3 text-sm">
          {issueKey && (
            <Alert variant="warning">
              <AlertTriangle />
              <AlertDescription>
                <span>{t(issueKey)}</span>
                {connectionStatus?.error && (
                  <code className="text-muted-foreground block truncate text-xs">
                    {connectionStatus.error}
                  </code>
                )}
              </AlertDescription>
            </Alert>
          )}
          <p>
            Edit this server and select Username + Password authentication to enable WebSocket
            real-time updates. For older token-based configurations, enter your credentials again.
            API key mode uses REST polling.
          </p>
          <ol className="list-decimal space-y-2 pl-4">
            <li>Download the latest Tracearr SSE Metrics release ZIP.</li>
            <li>Import it from Dispatcharr&apos;s My Plugins screen.</li>
            <li>Refresh or restart the plugin so Tracearr can detect the new version.</li>
          </ol>
          <a
            href="https://github.com/d4rk-4lchemy/Tracearr-SSE-Metrics/releases/latest"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary inline-flex items-center gap-1 hover:underline"
          >
            {t('servers.realtimeDialog.openReleases')}
            <ExternalLink className="h-3 w-3" />
          </a>
          <p className="text-xs">
            Tracearr detects the plugin version automatically after the Dispatcharr WebSocket
            reconnects.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('common:actions.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
