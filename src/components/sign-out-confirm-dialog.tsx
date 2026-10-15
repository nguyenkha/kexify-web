import { useTranslation } from "react-i18next";
import { signOut } from "../lib/auth";
import { ConfirmDialog } from "./ui/confirm-dialog";

/** UX spec settings.md "Sign out": confirm before clearing the session. */
export function SignOutConfirmDialog({ open, onCancel }: { open: boolean; onCancel: () => void }) {
  const { t } = useTranslation();
  return (
    <ConfirmDialog
      open={open}
      message={t("settings.signOutConfirm")}
      confirmLabel={t("nav.signOut")}
      destructive
      onConfirm={() => signOut()}
      onCancel={onCancel}
    />
  );
}
