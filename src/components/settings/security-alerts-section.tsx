import { isStandaloneJwt } from "../../lib/auth";
import { AlertEmailSetting } from "./alert-email-setting";
import { SecurityAlertsList } from "./security-alerts-list";

/** Settings > Security: the alerts feed, and for an anonymous wallet the optional alert email. */
export function SecurityAlertsSection() {
  return (
    <>
      <SecurityAlertsList />
      {isStandaloneJwt() && <AlertEmailSetting />}
    </>
  );
}
