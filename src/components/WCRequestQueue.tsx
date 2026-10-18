import { useEffect } from "react";
import { useWalletConnect } from "../context/WalletConnectContext";
import { WCSessionProposal } from "./WCSessionProposal";
import { WCRequestApproval } from "./WCRequestApproval";
import { useFrozen } from "../context/FrozenContext";
import { WcPhishingGate } from "./wc-phishing-gate";
import { wcService } from "../lib/walletconnect";

export function WCRequestQueue() {
  const frozen = useFrozen();
  const {
    pendingProposal,
    requestQueue,
    approveSession,
    rejectSession,
    approveRequest,
    rejectRequest,
    shiftRequest,
  } = useWalletConnect();

  // Auto-reject signing requests when frozen
  useEffect(() => {
    if (!frozen) return;
    const current = requestQueue[0];
    if (current) {
      rejectRequest(current.topic, current.id).then(() => shiftRequest());
    }
  }, [frozen, requestQueue, rejectRequest, shiftRequest]);

  // Session proposal takes priority
  if (pendingProposal) {
    // Scam-site check on the dApp's claimed URL and, when WalletConnect Verify has one, the origin it saw.
    const urls = [pendingProposal.params.proposer.metadata.url, pendingProposal.verifyContext?.verified?.origin];
    return (
      <WcPhishingGate key={pendingProposal.id} urls={urls} onReject={() => rejectSession(pendingProposal.params)}>
        <WCSessionProposal
          proposal={pendingProposal}
          onApprove={async (accounts) => {
            await approveSession(pendingProposal.params, accounts);
          }}
          onReject={async (reason) => {
            await rejectSession(pendingProposal.params, reason);
          }}
        />
      </WcPhishingGate>
    );
  }

  // Process signing requests one at a time
  const current = requestQueue[0];
  if (!current) return null;

  // Don't show approval UI when frozen — requests are auto-rejected above
  if (frozen) return null;

  const dappUrl = wcService.getSessions().find((s) => s.topic === current.topic)?.peer.metadata.url;
  const reject = async () => {
    await rejectRequest(current.topic, current.id);
    shiftRequest();
  };
  return (
    <WcPhishingGate key={`${current.topic}-${current.id}`} urls={[dappUrl]} onReject={reject}>
    <WCRequestApproval
      key={`${current.topic}-${current.id}`}
      request={current}
      onApprove={async (result) => {
        await approveRequest(current.topic, current.id, result);
        // Don't shift yet — let the done dialog stay visible
      }}
      onReject={reject}
      onDismiss={shiftRequest}
    />
    </WcPhishingGate>
  );
}
