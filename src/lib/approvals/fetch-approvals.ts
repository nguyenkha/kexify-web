import { proxyNetwork, proxyRead } from "../chains/chain-proxy-client";
import type { Chain } from "../../shared/types";
import { parseProxyApprovals } from "./proxy-approvals";
import { fetchPublicApprovals } from "./public-approvals";
import type { ApprovalsResult } from "./types";

/** Approvals of `address`: the server proxy when it serves the network, else (or when it answers nothing usable) public RPC. */
export async function fetchApprovals(chain: Chain, address: string): Promise<ApprovalsResult> {
  const network = proxyNetwork(chain);
  if (network) {
    const parsed = parseProxyApprovals(await proxyRead(network, "approvals", address));
    if (parsed) return parsed;
  }
  if (!chain.rpcUrl) throw new Error("No RPC URL for chain " + chain.name);
  return fetchPublicApprovals(chain.rpcUrl, address);
}
