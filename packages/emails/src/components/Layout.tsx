import { Hr, Img, Text } from '@react-email/components';
import type { ReactNode } from 'react';
import { colors, muted, paragraph } from '../styles.js';
import type { EmailBranding } from '../types.js';
import { Cell } from './Cell.js';
import { SentBy, headerName } from './SentBy.js';
import { Document } from './Document.js';

interface LayoutProps {
  preview: string;
  branding: EmailBranding;
  logoRef: string | null;
  children: ReactNode;
  footer?: ReactNode;
}

export function Layout({ preview, branding, logoRef, children, footer }: LayoutProps) {
  return (
    <Document preview={preview}>
      <Cell style={{ paddingBottom: '16px' }}>
        {logoRef && (
          <Img
            src={logoRef}
            alt={branding.senderName}
            width="40"
            height="40"
            style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: '12px' }}
          />
        )}
        <Text
          style={{
            ...paragraph,
            display: 'inline-block',
            verticalAlign: 'middle',
            fontWeight: 600,
            marginTop: 0,
            marginBottom: 0,
          }}
        >
          {headerName(branding)}
        </Text>
      </Cell>
      {children}
      <Hr style={{ borderColor: colors.border, margin: '24px 0 12px' }} />
      <Cell style={{ paddingTop: '16px' }}>
        {footer}
        {branding.footerText && <Text style={muted}>{branding.footerText}</Text>}
        {branding.postalAddress && <Text style={muted}>{branding.postalAddress}</Text>}
        <SentBy branding={branding} style={muted} />
      </Cell>
    </Document>
  );
}
