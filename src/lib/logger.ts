/** Dev-only logging — silent in production builds. */

export function devLog(...args: unknown[]): void {
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.log(...args);
  }
}

export function devWarn(...args: unknown[]): void {
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.warn(...args);
  }
}

export function devDebug(...args: unknown[]): void {
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.debug(...args);
  }
}

/** Critical failures — always logged. */
export function logError(...args: unknown[]): void {
  console.error(...args);
}
