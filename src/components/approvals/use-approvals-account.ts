import { useEffect, useState } from "react";
import { authHeaders } from "../../lib/auth";
import { fetchChains, type Chain } from "../../lib/api";
import { applyChainOverrides } from "../../lib/userOverrides";
import { getRecoveryKeys, isRecoveryMode } from "../../lib/recovery";
import { getChainAdapter } from "../../lib/chains/adapter";
import { registerWalletAddress } from "../../lib/chains/chain-proxy-client";
import { apiUrl } from "../../lib/apiBase";

export interface ApprovalsAccount { chain: Chain; address: string; keyName: string }

/** Resolves the EVM chain and the account address from the route params (same sources as AccountDetail). */
export function useApprovalsAccount(keyId: string | undefined, chainName: string | undefined) {
  const [account, setAccount] = useState<ApprovalsAccount | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        if (!keyId || !chainName) return;
        const keysPromise = isRecoveryMode()
          ? Promise.resolve(getRecoveryKeys())
          : fetch(apiUrl("/api/keys"), { headers: authHeaders() }).then((r) => r.json()).then((d) => d.keys || []);
        const [keys, rawChains] = await Promise.all([keysPromise, fetchChains()]);
        const chain = applyChainOverrides(rawChains).find((c: Chain) => c.name.toLowerCase() === chainName.toLowerCase());
        const key = keys.find((k: { id: string }) => k.id === keyId);
        if (!live || !chain || chain.type !== "evm" || !key?.publicKey) return;
        const testnet = chain.name.toLowerCase().includes("testnet");
        const address = getChainAdapter(chain.type).deriveAddress(key.publicKey, { testnet });
        registerWalletAddress(address, key.id);
        setAccount({ chain, address, keyName: key.name ?? "" });
      } catch {
        /* not found */
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => { live = false; };
  }, [keyId, chainName]);

  return { account, loading };
}
