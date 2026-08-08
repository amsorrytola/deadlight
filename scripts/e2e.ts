/**
 * End-to-end proof against a real chain: arm → embargo holds → heartbeat →
 * silence → guardians release → document decrypts. Uses the exact browser
 * crypto the dApp ships, not a stand-in.
 *
 *   RPC_URL=http://127.0.0.1:8545 PRIVATE_KEY=0x… ADDRESS=0x… node .e2e.mjs
 */
import { Contract, JsonRpcProvider, Wallet, keccak256 } from "ethers";
import { split, combine } from "../app/src/lib/shamir";
import { randomKey, encrypt, decrypt, enc, dec, toHex, fromHex } from "../app/src/lib/crypto";

const ABI = [
  "function arm(string title, string mimeType, bytes iv, bytes ciphertext, bytes32[] shareCommits, uint8 threshold, uint32 interval) returns (uint256)",
  "function heartbeat(uint256 id)",
  "function submitShare(uint256 id, uint8 index, bytes share)",
  "function vaultInfo(uint256 id) view returns (address,uint64,uint32,uint8,uint8,uint8,bool,bool,uint64,uint64,string,string,uint256)",
  "function ciphertextOf(uint256 id) view returns (bytes,bytes)",
  "function revealedShares(uint256 id) view returns (uint8[],bytes[])",
  "function isUnlocked(uint256 id) view returns (bool)",
];

const RPC = process.env.RPC_URL!;
const provider = new JsonRpcProvider(RPC, undefined, { staticNetwork: true });
const wallet = new Wallet(process.env.PRIVATE_KEY!, provider);
const c = new Contract(process.env.ADDRESS!, ABI, wallet);

let failures = 0;
const ok = (cond: boolean, msg: string) => {
  console.log(`${cond ? "  ✓" : "  ✗ FAIL"}  ${msg}`);
  if (!cond) failures++;
};

async function warp(seconds: number) {
  await provider.send("evm_increaseTime", [seconds]);
  await provider.send("evm_mine", []);
}

const SECRET = `CONFIDENTIAL — INTERNAL AUDIT 2026-Q3

Between March and July, 4,120 remittance transfers were routed
through the Meridian shell entity. Reconciliation was suppressed
by manual override in 3,880 of them.

Authorising signature on the override policy: [REDACTED]
Supporting ledger: attached, pages 14-91.`;

async function main() {
  console.log("\nDEADLIGHT — end-to-end\n");

  // ── seal ──────────────────────────────────────────────
  const key = randomKey();
  const { iv, ciphertext } = await encrypt(key, enc.encode(SECRET));
  const shares = split(key, 3, 2);
  const commits = shares.map((s) => keccak256(s));

  const tx = await c.arm("Internal audit — Q3 remittances", "text/plain", toHex(iv), toHex(ciphertext), commits, 2, 120);
  const rc = await tx.wait();
  const id = 0;
  console.log(`  armed vault #${id} — ${ciphertext.length} bytes on-chain, gas ${rc.gasUsed}\n`);

  // ── the embargo must hold ─────────────────────────────
  let rejected = false;
  try {
    await c.submitShare(id, 0, toHex(shares[0]));
  } catch {
    rejected = true;
  }
  ok(rejected, "guardian share REJECTED while the publisher is still checking in");

  // ── heartbeat rolls it forward ────────────────────────
  await warp(60);
  await (await c.heartbeat(id)).wait();
  const afterBeat = await c.vaultInfo(id);
  const now = (await provider.getBlock("latest"))!.timestamp;
  ok(Number(afterBeat[1]) > now + 100, "heartbeat rolled the deadline forward by the full interval");

  // ── then the publisher goes silent ────────────────────
  await warp(200);
  ok(!(await c.isUnlocked(id)), "still sealed after the lapse — silence alone does not reveal the key");

  let forged = false;
  try {
    await c.submitShare(id, 0, "0x01" + "ff".repeat(32));
  } catch {
    forged = true;
  }
  ok(forged, "forged share rejected by the on-chain commitment");

  await (await c.submitShare(id, 0, toHex(shares[0]))).wait();
  ok(!(await c.isUnlocked(id)), "one share below threshold — still sealed");

  await (await c.submitShare(id, 1, toHex(shares[1]))).wait();
  ok(await c.isUnlocked(id), "threshold reached — vault open to the world");

  // ── any stranger's browser can now decrypt ────────────
  const [, revealed] = await c.revealedShares(id);
  const rebuilt = combine(revealed.map((s: string) => fromHex(s)));
  const [ivOnChain, ctOnChain] = await c.ciphertextOf(id);
  const plaintext = dec.decode(await decrypt(rebuilt, fromHex(ivOnChain), fromHex(ctOnChain)));

  ok(plaintext === SECRET, "document reconstructed byte-for-byte from chain data alone");
  console.log("\n  ── released ──────────────────────────────");
  console.log(
    plaintext
      .split("\n")
      .map((l) => "  │ " + l)
      .join("\n"),
  );
  console.log("  ──────────────────────────────────────────\n");

  console.log(failures === 0 ? "E2E PASSED\n" : `E2E FAILED — ${failures} assertion(s)\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
