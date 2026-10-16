// Helpers that keep client key-share material in wipeable Uint8Arrays.
//
// JS strings are immutable and garbage-collected, so a share that becomes a string cannot
// be zeroed. These helpers let the paths that own the plaintext go bytes -> bytes, and wipe
// the buffers as soon as the cb-mpc handle (which lives in WASM memory) has been built.

/** Overwrite secret buffers with zeros. Best effort: copies made elsewhere are not reached. */
export function wipe(...bufs: Array<Uint8Array | Uint8Array[] | null | undefined>): void {
  for (const b of bufs) {
    if (!b) continue;
    if (Array.isArray(b)) b.forEach((p) => p.fill(0));
    else b.fill(0);
  }
}

const B64_INDEX = (() => {
  const t = new Int16Array(256).fill(-1);
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  for (let i = 0; i < alphabet.length; i++) t[alphabet.charCodeAt(i)] = i;
  return t;
})();
const PAD = 0x3d; // "="
const COMMA = 0x2c; // ","

/**
 * Decode standard base64 held as ASCII bytes (no string is created). As lenient as atob:
 * ASCII whitespace is skipped and padding is optional. Throws on any other character.
 */
export function base64DecodeAscii(ascii: Uint8Array): Uint8Array {
  let n = 0;
  let pad = 0;
  let end = ascii.length;
  while (end > 0 && (ascii[end - 1] === PAD || isSpace(ascii[end - 1]))) {
    if (ascii[end - 1] === PAD) pad++;
    end--;
  }
  for (let i = 0; i < end; i++) {
    if (isSpace(ascii[i])) continue;
    if (B64_INDEX[ascii[i]] < 0) throw new Error("Invalid base64 character");
    n++;
  }
  // atob: without padding any length but 4k+1; with padding, data + "=" must fill whole quads (at most "==").
  if (n % 4 === 1 || (pad > 0 && (pad > 2 || (n + pad) % 4 !== 0))) throw new Error("Invalid base64 length");
  const out = new Uint8Array(Math.floor((n * 6) / 8));
  let o = 0;
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < end; i++) {
    if (isSpace(ascii[i])) continue;
    acc = ((acc << 6) | B64_INDEX[ascii[i]]) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 0xff;
    }
  }
  acc = 0;
  return out;
}

function isSpace(c: number): boolean {
  return c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0c || c === 0x0d;
}

/**
 * Split a serialized cb-mpc share ("b64,b64,...", ASCII bytes) into its decoded parts.
 * Empty input gives no parts. The input is not modified; the caller wipes both.
 */
export function sharePartsFromAscii(ascii: Uint8Array): Uint8Array[] {
  if (ascii.length === 0) return [];
  const parts: Uint8Array[] = [];
  let start = 0;
  try {
    for (let i = 0; i <= ascii.length; i++) {
      if (i === ascii.length || ascii[i] === COMMA) {
        parts.push(base64DecodeAscii(ascii.subarray(start, i)));
        start = i + 1;
      }
    }
  } catch (err) {
    wipe(parts); // parts decoded before the bad one
    throw err;
  }
  return parts;
}

/** Same as sharePartsFromAscii for a share that already is a string (key file loaded as JSON). */
export function sharePartsFromString(share: string): Uint8Array[] {
  if (!share) return [];
  const ascii = new Uint8Array(share.length);
  try {
    for (let i = 0; i < share.length; i++) {
      const c = share.charCodeAt(i);
      if (c > 0x7f) throw new Error("Invalid base64 character");
      ascii[i] = c;
    }
    return sharePartsFromAscii(ascii);
  } finally {
    ascii.fill(0);
  }
}

/**
 * Byte range [start, end) of the value of a top-level `"name":"value"` string field in
 * JSON.stringify output. Only for values that need no JSON escaping (base64 shares): a
 * value with a backslash is rejected. Null when the field is absent.
 */
export function findJsonStringField(json: Uint8Array, name: string): [number, number] | null {
  const needle = new TextEncoder().encode(`"${name}":"`);
  outer: for (let i = 0; i + needle.length <= json.length; i++) {
    for (let j = 0; j < needle.length; j++) if (json[i + j] !== needle[j]) continue outer;
    // The key must start a member: preceded by "{" or "," (so "share" never matches inside a value).
    const prev = i > 0 ? json[i - 1] : 0;
    if (prev !== 0x7b && prev !== COMMA) continue;
    const start = i + needle.length;
    for (let k = start; k < json.length; k++) {
      if (json[k] === 0x5c) throw new Error(`Unexpected escape in ${name}`);
      if (json[k] === 0x22) return [start, k];
    }
    throw new Error(`Unterminated ${name}`);
  }
  return null;
}
