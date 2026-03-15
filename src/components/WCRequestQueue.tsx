import { useEffect } from "react";
import { useWalletConnect } from "../context/WalletConnectContext";
import { WCSessionProposal } from "./WCSessionProposal";
import { WCRequestApproval } from "./WCRequestApproval";
import { useFrozen } from "../context/FrozenContext";

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
    return (
      <WCSessionProposal
        proposal={pendingProposal}
        onApprove={async (accounts) => {
          await approveSession(pendingProposal.params, accounts);
        }}
        onReject={async () => {
          await rejectSession(pendingProposal.params);
        }}
      />
    );
  }

  // Process signing requests one at a time
  const current = requestQueue[0];
  if (!current) return null;

  // Don't show approval UI when frozen — requests are auto-rejected above
  if (frozen) return null;

  return (
    <WCRequestApproval
      key={`${current.topic}-${current.id}`}
      request={current}
      onApprove={async (result) => {
        await approveRequest(current.topic, current.id, result);
        // Don't shift yet — let the done dialog stay visible
      }}
      onReject={async () => {
        await rejectRequest(current.topic, current.id);
        shiftRequest();
      }}
      onDismiss={shiftRequest}
    />
  );
}
