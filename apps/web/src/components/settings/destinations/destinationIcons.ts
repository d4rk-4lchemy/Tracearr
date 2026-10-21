import { DESTINATION_TYPES, type DestinationKind } from '@tracearr/shared';
import {
  Bell,
  Globe,
  Mail,
  MessageSquare,
  Send,
  Share2,
  Smartphone,
  Webhook,
  type LucideIcon,
} from 'lucide-react';

const ICONS: Record<string, LucideIcon> = {
  MessageSquare,
  Webhook,
  Bell,
  Share2,
  Smartphone,
  Globe,
  Mail,
  Send,
};

export function iconFor(kind: DestinationKind): LucideIcon {
  return ICONS[DESTINATION_TYPES[kind].icon] ?? Bell;
}
