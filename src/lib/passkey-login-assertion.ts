// Passkey sign-in assertion WITH the escrow PRF salt, so a login also registers the passkey's escrow key (phase 4b).
// simplewebauthn's startAuthentication drops extensions, so this calls navigator.credentials.get itself (modal or
// conditional / autofill), on simplewebauthn's abort signal so cancelPasskeyAutofill keeps working. Only the escrow
// PUBLIC key leaves here; the PRF outputs and the derived secret are wiped.
import { base64URLStringToBuffer, WebAuthnAbortService } from "@simplewebauthn/browser";
import { splitAssertion, type AssertionJSON } from "./webauthn-assertion-json";
import { ESCROW_SALT, escrowPublicKey, escrowSecretFromPrf, wipePrfOutput } from "./passkey-escrow-key";
import { wipe } from "./secret-bytes";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OptionsJSON = any;

function requestOptions(options: OptionsJSON, withPrf: boolean): PublicKeyCredentialRequestOptions {
  return {
    challenge: base64URLStringToBuffer(options.challenge),
    rpId: options.rpId,
    timeout: options.timeout,
    userVerification: options.userVerification as UserVerificationRequirement,
    allowCredentials: (options.allowCredentials ?? []).map((c: { id: string; type: string; transports?: string[] }) => ({
      id: base64URLStringToBuffer(c.id), type: c.type, ...(c.transports ? { transports: c.transports } : {}),
    })),
    // Only the second (escrow) salt: a login never unlocks the browser share.
    ...(withPrf ? { extensions: { prf: { eval: { first: ESCROW_SALT } } } as AuthenticationExtensionsClientInputs } : {}),
  };
}

const cancelled = (err: unknown) => ["NotAllowedError", "AbortError"].includes(String((err as { name?: unknown })?.name));

/** One sign-in assertion; `escrowPublic` is set when the passkey answered the PRF request. */
export async function loginAssertionWithEscrowKey(options: OptionsJSON, autofill: boolean): Promise<{ credential: AssertionJSON; escrowPublic?: Uint8Array }> {
  const get = (withPrf: boolean) => navigator.credentials.get({
    publicKey: requestOptions(options, withPrf),
    signal: WebAuthnAbortService.createNewAbortSignal(),
    ...(autofill ? { mediation: "conditional" as CredentialMediationRequirement } : {}),
  }) as Promise<PublicKeyCredential | null>;
  let raw: PublicKeyCredential | null;
  try {
    raw = await get(true);
  } catch (err) {
    // A provider (or a conditional request) that fails on the PRF extension: sign in without it, the escrow key is
    // then just not sent. A dismissed prompt stays dismissed.
    if (cancelled(err)) throw err;
    raw = await get(false);
  }
  if (!raw) throw Object.assign(new Error("Authentication was not completed"), { name: "NotAllowedError" });
  const { credential, prfOutput, prfSecond } = splitAssertion(raw);
  // The escrow salt went in the FIRST slot here: a PRF output depends on the salt only, not on its slot.
  const out = prfOutput;
  if (!out) return { credential };
  let secret: Uint8Array | undefined;
  try {
    secret = await escrowSecretFromPrf(out);
    return { credential, escrowPublic: escrowPublicKey(secret) };
  } catch {
    return { credential };
  } finally {
    wipe(secret);
    wipePrfOutput(prfOutput);
    wipePrfOutput(prfSecond);
  }
}
