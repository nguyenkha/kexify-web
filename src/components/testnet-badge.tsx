import { testnetLabel } from "../lib/testnet";

/** Yellow "TESTNET" / "DEVNET" pill next to anything on a test network; renders nothing on mainnets. */
export function TestnetBadge({ chainName, small = false }: { chainName: string; small?: boolean }) {
  const label = testnetLabel(chainName);
  if (!label) return null;
  const size = small ? "text-[8px] px-0.5 py-px leading-none" : "text-[10px] px-1 py-0.5";
  return <span className={`${size} rounded bg-yellow-500/10 text-yellow-500 uppercase font-semibold`}>{label}</span>;
}
