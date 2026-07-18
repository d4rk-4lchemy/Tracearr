export function getBrowserWindow(): Window {
  return globalThis.window;
}

export function getBrowserDocument(): Document {
  return globalThis.document;
}

export function getBrowserNavigator(): Navigator {
  return globalThis.navigator;
}
