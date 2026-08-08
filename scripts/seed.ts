/**
 * Seed the live contract so a visitor lands on something alive: one switch
 * still ticking, and one that already went off.
 */
import { Contract, JsonRpcProvider, Wallet, keccak256 } from "ethers";
import { split } from "../app/src/lib/shamir";
import { randomKey, encrypt, enc, toHex } from "../app/src/lib/crypto";

const ABI = [
  "function arm(string title, string mimeType, bytes iv, bytes ciphertext, bytes32[] shareCommits, uint8 threshold, uint32 interval) returns (uint256)",
  "function submitShare(uint256 id, uint8 index, bytes share)",
  "function vaultCount() view returns (uint256)",
  "function isUnlocked(uint256 id) view returns (bool)",
];

const provider = new JsonRpcProvider(process.env.RPC_URL!, undefined, { staticNetwork: true });
const wallet = new Wallet(process.env.PRIVATE_KEY!, provider);
const c = new Contract(process.env.ADDRESS!, ABI, wallet);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function armVault(title: string, body: string, n: number, k: number, interval: number) {
  const key = randomKey();
  const { iv, ciphertext } = await encrypt(key, enc.encode(body));
  const shares = split(key, n, k);
  const commits = shares.map((s) => keccak256(s));
  const tx = await c.arm(title, "text/plain", toHex(iv), toHex(ciphertext), commits, k, interval);
  const rc = await tx.wait();
  const id = Number(await c.vaultCount()) - 1;
  console.log(`  #${id} armed — "${title}" (${k}-of-${n}, ${interval}s) gas ${rc.gasUsed}`);
  return { id, shares };
}

async function main() {
  // ── one that is still holding ───────────────────────────
  await armVault(
    "Meridian remittances — internal audit, Q3 2026",
    `CONFIDENTIAL — INTERNAL AUDIT, Q3 2026

Between March and July, 4,120 remittance transfers were routed through
the Meridian shell entity. Reconciliation was suppressed by manual
override in 3,880 of them.

This vault stays sealed for as long as I keep checking in.
If you are reading this, I stopped.`,
    5,
    3,
    604800, // 7 days — a real-world cadence
  );

  // ── one that already went off ───────────────────────────
  const { id, shares } = await armVault(
    "Northern Grid tender awards — released by silence",
    `TENDER AWARDS — NORTHERN GRID, 2026

Three of the four "competitive" awards were pre-allocated before the
bidding window opened. Scoring sheets were back-filled on 14 June.

Nobody unsealed this. The publisher simply stopped checking in, the
deadline lapsed, and two guardians published their shares. That is the
entire mechanism: silence is the trigger.`,
    3,
    2,
    60,
  );

  console.log("\n  waiting out the 60s deadline…");
  await sleep(75_000);

  console.log("  guardians publishing…");
  await (await c.submitShare(id, 0, toHex(shares[0]))).wait();
  await (await c.submitShare(id, 1, toHex(shares[1]))).wait();
  console.log(`  #${id} unlocked: ${await c.isUnlocked(id)}`);
  console.log("\nseeded.\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
