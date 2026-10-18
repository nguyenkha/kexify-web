import { useMemo, useState } from "react";
import { WCRequestApproval } from "../WCRequestApproval";
import type { Chain } from "../../lib/api";
import { revokeCalldata } from "../../lib/approvals/calldata";
import type { Approval } from "../../lib/approvals/types";
import { revokeOriginTokens, type ContractInfo } from "../../lib/approvals/approval-labels";

interface Props {
  chain: Chain;
  owner: string;
  approval: Approval;
  info?: ContractInfo;
  onSent: () => void;
  onClose: () => void;
}

/** A revoke goes through the normal review, policy pre-check, passkey and MPC signing: the same sheet as a dApp request. */
export function RevokeRequest({ chain, owner, approval, info, onSent, onClose }: Props) {
  const [id] = useState(() => Date.now());
  const request = useMemo(() => ({
    topic: "kexify:revoke",
    id,
    method: "eth_sendTransaction",
    params: [{ from: owner, to: approval.contract, value: "0x0", data: revokeCalldata(approval) }],
    chainId: `eip155:${chain.evmChainId}`,
  }), [id, chain.evmChainId, owner, approval]);
  const origin = useMemo(() => ({
    name: "Kexify",
    icon: `${import.meta.env.BASE_URL}icon.svg`,
    tokens: revokeOriginTokens(approval.contract, info),
  }), [info, approval.contract]);

  return (
    <WCRequestApproval
      request={request}
      origin={origin}
      onApprove={onSent}
      onReject={onClose}
      onDismiss={onClose}
    />
  );
}
