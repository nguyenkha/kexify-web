import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { confirmAlertEmail, type ConfirmEmailResult } from "../lib/security-alerts-api";
import { Button, Spinner } from "./ui";
import { PublicLinkShell } from "./public-link-shell";

/** /alerts/confirm-email?token=: confirms the alert email on the button press only (never on page load). */
export function AlertEmailConfirmPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const token = useSearchParams()[0].get("token");
  const [state, setState] = useState<"ask" | "busy" | ConfirmEmailResult>(token ? "ask" : "expired");

  async function confirm() {
    setState("busy");
    setState(await confirmAlertEmail(token!));
  }

  if (state === "ask") {
    return (
      <PublicLinkShell tone="warn" title={t("confirmEmailLink.title")} body={t("confirmEmailLink.body")}>
        <Button fullWidth onClick={confirm}>{t("confirmEmailLink.confirm")}</Button>
      </PublicLinkShell>
    );
  }
  if (state === "busy") return <PublicLinkShell tone="warn" title={t("confirmEmailLink.title")}><Spinner size="lg" /></PublicLinkShell>;
  const ok = state === "confirmed";
  return (
    <PublicLinkShell
      tone={ok ? "ok" : "error"}
      title={t(ok ? "confirmEmailLink.done" : "confirmEmailLink.notDone")}
      body={t(ok ? "confirmEmailLink.doneBody" : state === "expired" ? "confirmEmailLink.expired" : "confirmEmailLink.failed")}
    >
      <Button variant="secondary" fullWidth onClick={() => navigate("/accounts")}>{t("confirmEmailLink.open")}</Button>
    </PublicLinkShell>
  );
}
