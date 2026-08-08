/**
 * Shamir secret sharing over GF(2^8), AES field (irreducible poly 0x11b).
 *
 * A share is 33 bytes: [x, ...y] where x is the evaluation point (1..n) and y
 * holds one field element per secret byte. The on-chain commitment is
 * keccak256 over exactly these 33 bytes, so a guardian can prove their share is
 * the real one without anybody learning it early.
 */

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);

(function buildTables() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    let d = x << 1;
    if (d & 0x100) d ^= 0x11b; // reduce by the AES polynomial
    x = (x ^ d) & 0xff; // x * 3 — 3 generates GF(256)*
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

function mul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a] + LOG[b]];
}

function div(a: number, b: number): number {
  if (b === 0) throw new Error("division by zero in GF(256)");
  if (a === 0) return 0;
  return EXP[LOG[a] - LOG[b] + 255];
}

/**
 * Split `secret` into `n` shares, any `k` of which reconstruct it.
 * Fewer than k shares reveal nothing — that is the whole security argument for
 * handing shares to guardians who may themselves be compromised.
 */
export function split(secret: Uint8Array, n: number, k: number): Uint8Array[] {
  if (n < 1 || n > 255) throw new Error("n must be 1..255");
  if (k < 1 || k > n) throw new Error("k must be 1..n");

  // coeffs[j] holds the polynomial for secret byte j: constant term = the byte.
  const coeffs: Uint8Array[] = [];
  for (let j = 0; j < secret.length; j++) {
    const poly = new Uint8Array(k);
    poly[0] = secret[j];
    if (k > 1) {
      const rand = new Uint8Array(k - 1);
      crypto.getRandomValues(rand);
      // Leading coefficient must be non-zero or the polynomial degrades in degree.
      if (rand[k - 2] === 0) rand[k - 2] = 1;
      poly.set(rand, 1);
    }
    coeffs.push(poly);
  }

  const shares: Uint8Array[] = [];
  for (let i = 1; i <= n; i++) {
    const share = new Uint8Array(secret.length + 1);
    share[0] = i;
    for (let j = 0; j < secret.length; j++) {
      // Horner evaluation of the j-th polynomial at x = i.
      const poly = coeffs[j];
      let acc = poly[k - 1];
      for (let d = k - 2; d >= 0; d--) acc = mul(acc, i) ^ poly[d];
      share[j + 1] = acc;
    }
    shares.push(share);
  }
  return shares;
}

/** Reconstruct the secret by Lagrange interpolation at x = 0. */
export function combine(shares: Uint8Array[]): Uint8Array {
  if (shares.length === 0) throw new Error("no shares");
  const len = shares[0].length - 1;
  if (shares.some((s) => s.length - 1 !== len)) throw new Error("share length mismatch");

  const xs = shares.map((s) => s[0]);
  if (new Set(xs).size !== xs.length) throw new Error("duplicate share indices");
  if (xs.some((x) => x === 0)) throw new Error("invalid share index 0");

  const out = new Uint8Array(len);
  for (let j = 0; j < len; j++) {
    let acc = 0;
    for (let i = 0; i < shares.length; i++) {
      // basis_i = product over m != i of x_m / (x_m - x_i); subtraction is XOR here.
      let basis = 1;
      for (let m = 0; m < shares.length; m++) {
        if (m === i) continue;
        basis = mul(basis, div(xs[m], xs[m] ^ xs[i]));
      }
      acc ^= mul(shares[i][j + 1], basis);
    }
    out[j] = acc;
  }
  return out;
}
