import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { declineByEmailLink, type DeclineLinkResult } from "../lib/security-alerts-api";
import { Button, Spinner } from "./ui";
import { PublicLinkShell } from "./public-link-shell";

/**
 * /signers/decline?token=: the "No, stop it" link of a device-move email. Acts only on the button press
 * (mail scanners open links), never on page load.
 */
export function SignerDeclinePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const token = useSearchParams()[0].get("token");
  const [state, setState] = useState<"ask" | "busy" | DeclineLinkResult>(token ? "ask" : "expired");

  async function stop() {
    setState("busy");
    setState(await declineByEmailLink(token!));
  }
  const toLogin = <Button variant="secondary" fullWidth onClick={() => navigate("/login")}>{t("declineLink.signIn")}</Button>;

  if (state === "ask") {
    return (
      <PublicLinkShell tone="warn" title={t("declineLink.title")} body={t("declineLink.body")}>
        <Button variant="danger" fullWidth onClick={stop}>{t("restore.ask.no")}</Button>
      </PublicLinkShell>
    );
  }
  if (state === "busy") return <PublicLinkShell tone="warn" title={t("declineLink.stopping")}><Spinner size="lg" /></PublicLinkShell>;
  if (state === "stopped" || state === "stoppedFrozen") {
    return (
      <PublicLinkShell tone="ok" title={t("declineLink.stopped")} body={t(state === "stoppedFrozen" ? "declineLink.stoppedFrozen" : "declineLink.stoppedAnon")}>
        {toLogin}
      </PublicLinkShell>
    );
  }
  const body = state === "alreadyActive" ? "declineLink.alreadyActive" : state === "alreadyStopped" ? "declineLink.alreadyStopped"
    : state === "expired" ? "declineLink.expired" : "declineLink.failed";
  return <PublicLinkShell tone="error" title={t("declineLink.notDone")} body={t(body)}>{toLogin}</PublicLinkShell>;
}
