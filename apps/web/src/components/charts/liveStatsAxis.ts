// Shared x-axis for the live stats cards: CPU, RAM, and bandwidth sit in one
// row, so they use one grid and one label set to read as a single system
export const LIVE_STATS_X_LABELS: Record<number, string> = {
  [-120]: '2m',
  [-100]: '1m 40s',
  [-80]: '1m 20s',
  [-60]: '1m',
  [-40]: '40s',
  [-20]: '20s',
  [0]: 'NOW',
};

export const LIVE_STATS_TICK_INTERVAL = 20;
export const LIVE_STATS_TICK_INTERVAL_NARROW = 40;
