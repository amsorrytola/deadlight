/**
 * AES-256-GCM via WebCrypto. The key never leaves the browser: it is generated
 * here, split with Shamir, and immediately discarded. Nothing in this app —
 * and nothing on the chain — can reconstruct it before the guardians act.
 */

export function randomKey(): Uint8Array {
  const k = new Uint8Array(32);
  crypto.getRandomValues(k);
  return k;
}

export function randomIv(): Uint8Array {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  return iv;
}

async function importKey(raw: Uint8Array, usage: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", raw as BufferSource, "AES-GCM", false, usage);
}

export async function encrypt(
  key: Uint8Array,
  plaintext: Uint8Array,
): Promise<{ iv: Uint8Array; ciphertext: Uint8Array }> {
  const iv = randomIv();
  const ck = await importKey(key, ["encrypt"]);
  const buf = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, ck, plaintext as BufferSource);
  return { iv, ciphertext: new Uint8Array(buf) };
}

export async function decrypt(key: Uint8Array, iv: Uint8Array, ciphertext: Uint8Array): Promise<Uint8Array> {
  const ck = await importKey(key, ["decrypt"]);
  const buf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    ck,
    ciphertext as BufferSource,
  );
  return new Uint8Array(buf);
}

export const enc = new TextEncoder();
export const dec = new TextDecoder();

export function toHex(b: Uint8Array): string {
  return "0x" + Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

export function fromHex(h: string): Uint8Array {
  const s = h.startsWith("0x") ? h.slice(2) : h;
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16);
  return out;
}

/** Base64 for share hand-off — what a guardian actually copies and stores. */
export function toB64(b: Uint8Array): string {
  return btoa(String.fromCharCode(...b));
}

export function fromB64(s: string): Uint8Array {
  const bin = atob(s.trim());
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
