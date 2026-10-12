import { createAuthClient } from 'better-auth/react';
import { adminClient, usernameClient } from 'better-auth/client/plugins';
// The admin client's inferred type names these; importing them gives the declaration a path to them.
import type {} from 'better-auth/plugins/access';
import { API_BASE_URL } from './api';

// better-auth's client requires an absolute URL (it parses baseURL with `new URL()`),
// so we resolve API_BASE_URL against the current origin rather than passing it as-is.
export const authClient = createAuthClient({
  baseURL: new URL(`${API_BASE_URL}/auth`, window.location.origin).toString(),
  plugins: [usernameClient(), adminClient()],
});
