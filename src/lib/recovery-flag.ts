// Whether recovery mode is active, without the recovery module itself. Code that ships in the iOS chain bundle
// (chain adapters, chain-proxy client) checks this flag, so the bundle never pulls in cb-mpc WASM or node:* imports.
// recovery.ts is the only writer.
let active = false;

export function setRecoveryActive(on: boolean): void {
  active = on;
}

export function isRecoveryActive(): boolean {
  return active;
}
