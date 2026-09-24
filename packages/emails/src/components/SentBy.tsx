import { Text } from '@react-email/components';
import type { CSSProperties } from 'react';
import type { EmailBranding } from '../types.js';

export const APP_NAME = 'Tracearr';

/** Header name beside the logo: the configured title, else who the send is about. */
export function headerName(branding: EmailBranding): string {
  return branding.systemTitle ?? branding.senderName;
}

/**
 * Attribution under the footer, in every template. Sends with no name of their
 * own carry the app's, and "Sent by Tracearr for Tracearr." is not a sentence.
 */
export function SentBy({ branding, style }: { branding: EmailBranding; style: CSSProperties }) {
  const suffix = branding.senderName === APP_NAME ? '' : ` for ${branding.senderName}`;
  return <Text style={style}>{`Sent by ${APP_NAME}${suffix}.`}</Text>;
}
