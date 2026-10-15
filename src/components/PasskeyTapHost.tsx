import { useEffect, useRef, useState } from "react";
import { PasskeyChallenge } from "./PasskeyChallenge";
import { subscribePasskeyTap, type PasskeyTapRequest } from "../lib/passkey-tap-prompt";

/** The user dismissed the Confirm button: a cancel (NotAllowedError), keeping the old message for older callers. */
function cancelError(): Error {
  const e = new Error("passkey_auth_required");
  e.name = "NotAllowedError";
  return e;
}

/** Shows a Confirm button for a passkey prompt the browser refused without a user gesture. */
export function PasskeyTapHost() {
  const [req, setReq] = useState<{ id: number; r: PasskeyTapRequest } | null>(null);
  const nextId = useRef(0);
  useEffect(() => subscribePasskeyTap((r) => setReq({ id: ++nextId.current, r })), []);
  if (!req) return null;
  const { id, r } = req;
  // Only close our own request: a superseded ceremony finishing late must not hide a newer one.
  const close = () => setReq((cur) => (cur?.id === id ? null : cur));
  return (
    <PasskeyChallenge
      key={id}
      withPrf={r.withPrf}
      action={r.action}
      onAuthenticated={(res) => { close(); r.resolve(res); }}
      onCancel={() => { close(); r.reject(cancelError()); }}
    />
  );
}
