import { fitText, type DestinationTextProfile } from '@tracearr/shared';
import type { NotificationPayload } from '../types.js';

/** The automation's rendered text wins over the kind's builtin copy, field by field. */
export function textOf(
  payload: NotificationPayload,
  defaults: { title: string; message: string }
): { title: string; message: string } {
  return {
    title: payload.automation?.title ?? defaults.title,
    message: payload.automation?.message ?? defaults.message,
  };
}

/** For events whose builtin copy is already on the payload; an override still wins. */
export function ownText(payload: NotificationPayload): { title: string; message: string } {
  return textOf(payload, { title: payload.title, message: payload.message });
}

/** The finished title and body cut to what the destination accepts, default text included. */
export function fitted(
  text: { title: string; message: string },
  profile: DestinationTextProfile
): { title: string; message: string } {
  return {
    title: profile.title ? fitText(text.title, profile.title) : text.title,
    message: profile.body ? fitText(text.message, profile.body) : text.message,
  };
}
