import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { DomainMovedNotice } from "./DomainMovedNotice";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AuthError, requestMagicLink } from "../lib/auth";
import { passkeySignInSupported, signInWithPasskey } from "../lib/passkey-sign-in";
import { usePasskeyAutofill } from "../lib/use-passkey-autofill";
import { authErrorMessage } from "../lib/auth-error-message";
import { ErrorBox } from "./ui";
import { LoginCodeForm } from "./login-code-form";
import { ThemeToggleButton } from "./theme-toggle-button";
import { LangSwitcher } from "./LangSwitcher";
import { cleanupStaleShares } from "../lib/keystore";
import { KeyRound, Mail } from "lucide-react";

const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;
const RESEND_SECONDS = 30;
const LAST_EMAIL_KEY = "kxi:lastEmail";

type TurnstileApi = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  reset: (id: string) => void;
  remove: (id: string) => void;
};
const turnstileApi = () => (window as unknown as { turnstile?: TurnstileApi }).turnstile;

/** Detect in-app browsers (Facebook, Instagram, TikTok, etc.) */
function isInAppBrowser(): boolean {
  const ua = navigator.userAgent || "";
  return /FBAN|FBAV|Instagram|Line\/|Twitter|TikTok|Snapchat|WeChat|MicroMessenger/i.test(ua);
}

export function Login() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const sessionEnded = searchParams.get("session") === "ended";
  const [email, setEmail] = useState(() => localStorage.getItem(LAST_EMAIL_KEY) ?? "");
  const [sent, setSent] = useState(false);
  const [sendCount, setSendCount] = useState(0);
  const [resendIn, setResendIn] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const inApp = useMemo(isInAppBrowser, []);
  const [copied, setCopied] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const turnstileRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const passkeyAvailable = useMemo(passkeySignInSupported, []);
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const signedIn = useCallback(() => navigate("/", { replace: true }), [navigate]);
  // Passkeys in the email field's autofill list; paused while the modal prompt runs.
  usePasskeyAutofill(passkeyAvailable && !sent && !passkeyBusy, signedIn, (err) => setError(authErrorMessage(err, t)));
  // Cleanup corrupted shares on login page mount
  useEffect(() => { cleanupStaleShares(); }, []);

  // Resend countdown (30 s after each send)
  useEffect(() => {
    if (resendIn <= 0) return;
    const id = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [resendIn]);

  // The widget lives under the email field (step 1) or above Resend (step 2, once allowed)
  const turnstileSlot = !sent ? "email" : resendIn <= 0 ? "resend" : null;

  // Load Turnstile script and render widget into the current slot
  const renderTurnstile = useCallback(() => {
    const api = turnstileApi();
    if (!TURNSTILE_SITE_KEY || !turnstileRef.current || !api) return;
    if (widgetIdRef.current) {
      try { api.remove(widgetIdRef.current); } catch { /* old node already gone */ }
    }
    setCaptchaToken(null);
    widgetIdRef.current = api.render(turnstileRef.current, {
      sitekey: TURNSTILE_SITE_KEY,
      theme: "dark",
      callback: (token: string) => setCaptchaToken(token),
      "expired-callback": () => setCaptchaToken(null),
      "error-callback": () => setCaptchaToken(null),
    });
  }, []);

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY || !turnstileSlot) return;
    if (turnstileApi()) {
      renderTurnstile();
      return;
    }
    if (document.querySelector('script[src*="turnstile"]')) return; // still loading; onload renders
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.onload = renderTurnstile;
    document.head.appendChild(script);
  }, [renderTurnstile, turnstileSlot]);

  function resetCaptcha() {
    setCaptchaToken(null);
    const api = turnstileApi();
    if (widgetIdRef.current && api) api.reset(widgetIdRef.current);
  }

  async function sendLink() {
    if (TURNSTILE_SITE_KEY && !captchaToken) {
      setError(t("login.captchaRequired"));
      return;
    }
    setLoading(true);
    setError("");
    try {
      await requestMagicLink(email, captchaToken ?? undefined);
      localStorage.setItem(LAST_EMAIL_KEY, email);
      setSent(true);
      setSendCount((n) => n + 1);
      setResendIn(RESEND_SECONDS);
    } catch (err) {
      setError(authErrorMessage(err, t));
      // Captcha tokens are single use: reset so the user can retry
      resetCaptcha();
    } finally {
      setLoading(false);
    }
  }

  async function passkeySignIn() {
    setPasskeyBusy(true);
    setError("");
    try {
      await signInWithPasskey();
      signedIn();
    } catch (err) {
      // A dismissed prompt is the user's choice, not an error.
      if (!(err instanceof AuthError && err.code === "passkeyCancelled")) setError(authErrorMessage(err, t));
    } finally {
      setPasskeyBusy(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    sendLink();
  }

  function changeEmail() {
    setSent(false);
    setError("");
    setResendIn(0);
  }

  return (
    <div className="min-h-dvh bg-surface-primary text-text-primary flex items-center justify-center pb-16">
      <div className="max-w-sm w-full px-4">
        {/* Logo + branding */}
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold tracking-tight">kexify</h1>
          <p className="text-[11px] text-text-muted mt-0.5">{t("login.tagline")}</p>
        </div>

        {sessionEnded && !sent && (
          <div role="status" className="mb-4 bg-surface-secondary border border-border-primary rounded-lg p-3 text-center text-xs text-text-secondary">
            {t("lock.sessionEnded")}
          </div>
        )}

        {inApp && (
          <div className="mb-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3 text-center">
            <p className="text-yellow-400 text-xs font-medium mb-1">{t("login.inAppBrowser")}</p>
            <p className="text-text-muted text-[10px] mb-2">{t("login.inAppBrowserDesc")}</p>
            <button
              onClick={() => {
                navigator.clipboard.writeText(window.location.href);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              className="text-[10px] px-3 py-1 rounded bg-surface-tertiary text-text-secondary hover:text-text-primary transition-colors"
            >
              {copied ? "✓" : t("login.copyLink")}
            </button>
          </div>
        )}

        {sent ? (
          <div className="space-y-4">
            <div className="bg-surface-secondary border border-border-primary rounded-lg p-4">
              <p className="text-green-400 text-sm font-medium mb-1">{t("login.checkEmail")}</p>
              <p className="text-text-tertiary text-xs">
                {t("login.sentTo")} <span className="text-text-primary">{email}</span>
              </p>
            </div>

            {/* Code input for PWA users; remounted on every send */}
            <LoginCodeForm key={sendCount} email={email} onVerified={() => navigate("/", { replace: true })} />

            <div className="space-y-2 text-center text-xs">
              {resendIn > 0 ? (
                <p className="text-text-muted tabular-nums">{t("auth.resendIn", { seconds: resendIn })}</p>
              ) : (
                <>
                  {TURNSTILE_SITE_KEY && <div ref={turnstileRef} className="flex justify-center" />}
                  <button
                    type="button"
                    onClick={sendLink}
                    disabled={loading || (!!TURNSTILE_SITE_KEY && !captchaToken)}
                    className="text-blue-400 hover:text-blue-300 disabled:text-text-muted disabled:cursor-not-allowed transition-colors"
                  >
                    {loading ? t("login.sending") : t("auth.resend")}
                  </button>
                  {error && <ErrorBox>{error}</ErrorBox>}
                </>
              )}
              <div>
                <button
                  type="button"
                  onClick={changeEmail}
                  className="text-text-muted hover:text-text-secondary transition-colors"
                >
                  {t("auth.changeEmail")}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <>
          <DomainMovedNotice className="mb-4" />
          {passkeyAvailable && (
            <>
              <button
                type="button"
                onClick={passkeySignIn}
                disabled={passkeyBusy}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-surface-tertiary disabled:text-text-muted disabled:cursor-not-allowed px-4 py-2.5 rounded-lg text-sm font-medium transition-colors text-white"
              >
                {passkeyBusy ? t("login.signingInWithPasskey") : <><KeyRound className="w-4 h-4 inline-block align-[-2px] mr-1" />{t("login.signInWithPasskey")}</>}
              </button>
              <div className="my-4 flex items-center gap-3 text-[11px] text-text-muted">
                <span className="flex-1 border-t border-border-primary" />
                {t("login.orEmail")}
                <span className="flex-1 border-t border-border-primary" />
              </div>
            </>
          )}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-xs text-text-muted mb-1.5">
                {t("login.email")}
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username webauthn"
                required
                className="w-full bg-surface-secondary border border-border-primary rounded-lg px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-blue-500 transition-colors"
                placeholder={t("login.emailPlaceholder")}
              />
            </div>

            {TURNSTILE_SITE_KEY && (
              <div ref={turnstileRef} className="flex justify-center" />
            )}

            <button
              type="submit"
              disabled={loading || (!!TURNSTILE_SITE_KEY && !captchaToken)}
              className={`w-full ${passkeyAvailable ? "bg-surface-secondary hover:bg-surface-tertiary border border-border-primary text-text-primary" : "bg-blue-600 hover:bg-blue-700 text-white"} disabled:bg-surface-tertiary disabled:text-text-muted disabled:cursor-not-allowed px-4 py-2.5 rounded-lg text-sm font-medium transition-colors`}
            >
              {loading ? t("login.sending") : <><Mail className="w-4 h-4 inline-block align-[-2px] mr-1" />{t("login.sendMagicLink")}</>}
            </button>

            {error && <div role="alert"><ErrorBox>{error}</ErrorBox></div>}
          </form>
          </>
        )}

        {/* Bottom links */}
        {!sent && (
          <div className="mt-6 pt-5 border-t border-border-primary flex items-center justify-center gap-3 text-[11px]">
            <Link to="/standalone" className="text-text-muted hover:text-text-secondary transition-colors">
              {t("login.useWithoutEmail")}
            </Link>
            <span className="text-border-primary">·</span>
            <Link to="/recovery" className="text-text-muted hover:text-orange-400 transition-colors">
              {t("login.recoveryMode")}
            </Link>
          </div>
        )}
      </div>

      {/* Theme & language toggle - bottom left */}
      <div className="fixed bottom-4 left-4 flex items-center gap-1">
        <ThemeToggleButton className="p-2 rounded-md text-text-muted hover:text-text-secondary hover:bg-surface-tertiary transition-colors" />
        <LangSwitcher />
      </div>
    </div>
  );
}
