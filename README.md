<div align="center">

# DEADLIGHT

### Silencing the author is what publishes the document.

A censorship-resistant dead man's switch. The ciphertext lives entirely in contract
state — no server, no IPFS pin, no host to subpoena. The key is shattered across
guardians. While the publisher checks in, the chain **refuses** every attempt to
open it. The moment they go silent, it publishes itself.

**[▸ Live app](https://amsorrytola.github.io/deadlight/)** ·
**[▸ Contract on Sepolia](https://sepolia.etherscan.io/address/0xd4aC45705278Bb49aBdbF938ee596dE29fB0Be92)**

*Road to Devcon — IIT Roorkee · Tracks: Censorship Resistance, Self-Sovereignty*

</div>

---

## The problem

Every "uncensorable publishing" tool has the same hole in it: someone has to be
holding the material, and that someone can be reached.

- **Publish now** and you are the target before anyone has read it.
- **Give it to a journalist** and the leverage moves to them — a court order, a
  raid, an editor who folds.
- **Encrypt and hand out the key** and any keyholder can be compelled to open it
  early, or paid to.
- **Store it on IPFS** and the pin lapses, the gateway blocks, the CID is
  filtered. Availability is a promise, not a property.

The common failure is that **suppression works**. Pressure applied to the right
person, at the right moment, makes the document not exist.

## The inversion

Deadlight makes suppression *counterproductive*. The document is armed to release
on silence. Detaining the publisher does not prevent publication — it **causes**
it. The rational move for an adversary flips from "silence them" to "keep them
comfortable, free, and checking in," which is the outcome the publisher wanted.

Crucially, the embargo is not a promise made by guardians. It is enforced by the
contract: `submitShare` **reverts** while the countdown is alive. Every guardian
could collude, or be served by the same court on the same morning, and the
document still would not open a second early.

## How it works

```
    ARM                                  RELEASE
    ───                                  ───────
    document                             deadline lapses
       │ AES-256-GCM (in-browser)           │
       ▼                                    ▼
    ciphertext ──────► contract state    submitShare() now permitted
       │                                    │
    key (256-bit)                        guardians publish shares
       │ Shamir k-of-n over GF(2⁸)          │  (commitment-checked on-chain)
       ▼                                    ▼
    n shares ──► guardians               k shares reached
       │                                    │
    keccak256(share) ──► contract        every visitor's browser
       │                                 reconstructs the key locally
    key zeroed, never stored                │
                                            ▼
    heartbeat() every interval           plaintext, for everyone, forever
```

1. **The document never leaves the browser in the clear.** A 256-bit key is
   generated in the tab, the document is sealed with AES-256-GCM, and the
   ciphertext is written into contract storage. Not a gateway, not a pin —
   contract state, replicated by every node on the network.

2. **The key is shattered, then destroyed.** Shamir's scheme over GF(2⁸) splits it
   into `n` shares, any `k` of which rebuild it. Fewer than `k` reveal *nothing* —
   the reconstruction is information-theoretically blind below threshold. The
   assembled key is zeroed before the transaction is even signed.

3. **Only commitments go on-chain.** The contract stores `keccak256` of each share:
   enough to prove a share is genuine when it arrives, useless for reconstructing
   anything before then.

4. **The chain enforces the embargo.** `submitShare` reverts with `StillAlive`
   until the deadline passes. This is the load-bearing idea — the guarantee does
   not depend on guardians being brave, honest, or beyond reach.

5. **Silence is the trigger.** Miss one check-in and submission opens permanently.
   `heartbeat` and `revoke` *both* stop working at the deadline, so seizing the
   publisher's key after the lapse cannot bury the release either.

6. **Anyone can finish it.** Share submission is permissionless — the commitment
   check is the only gate. A guardian who is themselves silenced can hand their
   share to a stranger and the release still happens.

## What it costs an adversary

| Attack | Result |
|---|---|
| Seize the host | Nothing to seize — ciphertext is contract state |
| Take down the frontend | Static files; anyone can rebuild and re-host from this repo |
| Detain the publisher | **Publishes the document.** This is the intended failure mode |
| Compel the publisher's key | Buys time only while they are free; after the lapse the key does nothing |
| Compel *every* guardian | Cannot open it early — the contract rejects shares before the deadline |
| Buy off `k` guardians | Cannot open it early either; only ever *delays* nothing |
| Silence `k` guardians permanently | The one real attack — mitigated by choosing `n`, `k`, and jurisdictions well, and by shares being delegable to unknown parties |

## Self-sovereignty

- **No account, no extension, no KYC.** The app generates a burner key in the
  browser and keeps it in `localStorage`. A publisher in a hostile jurisdiction
  should not have to install identifiable software or touch a wallet tied to their
  name. A browser wallet is supported but never required.
- **Reading needs no key at all.** Any visitor decrypts a released vault locally.
- **The right to withdraw.** `revoke` lets an author stand down and seal their own
  words forever — but only from a position of freedom, never after the lapse.

## Repo layout

```
contracts/          Foundry project
  src/Deadlight.sol   the switch — 13 tests, incl. fuzz
  test/
app/                Vite + React + TypeScript frontend
  src/lib/shamir.ts   Shamir over GF(2⁸), no dependencies
  src/lib/crypto.ts   AES-256-GCM via WebCrypto
  src/lib/chain.ts    ethers v6 wiring, burner-key custody
scripts/
  deploy.sh           deploy + regenerate frontend config
  e2e.ts              full lifecycle against a live chain
  seed.ts             seed demo vaults
```

## Run it

```bash
# contracts
cd contracts && forge test -vv

# full lifecycle against a local chain
anvil &
forge create src/Deadlight.sol:Deadlight --rpc-url http://127.0.0.1:8545 \
  --private-key 0xac09…ff80 --broadcast
cd ../app && npm i
npx esbuild ../scripts/e2e.ts --bundle --platform=node --format=esm \
  --packages=external --outfile=.e2e.mjs
RPC_URL=http://127.0.0.1:8545 PRIVATE_KEY=0xac09…ff80 ADDRESS=0x… node .e2e.mjs

# frontend
npm run dev
```

Deploy anywhere EVM:

```bash
RPC_URL=… PRIVATE_KEY=… ./scripts/deploy.sh "Sepolia" "https://sepolia.etherscan.io"
```

## Tests

`forge test` — 13 passing, including the two properties the whole design rests on:

- `test_SharesRejectedWhilePublisherAlive` — colluding guardians **cannot** open it early
- `test_HeartbeatUselessAfterLapse` — a captor **cannot** re-arm it to bury the leak

`scripts/e2e.ts` runs the real lifecycle against a live chain using the exact
browser crypto the dApp ships — arm → embargo holds → heartbeat → silence →
forged share rejected → threshold reached → plaintext reconstructed byte-for-byte
from chain data alone.

## Honest limits

- **8 KB document cap.** Contract storage costs ~20k gas per 32 bytes. Production
  belongs in blobs (EIP-4844) or calldata with only the hash in state — the
  security argument is unchanged, the price is not.
- **Guardians must keep their shares.** Lose more than `n − k` and the document is
  sealed forever. This is a real operational burden, not a footnote.
- **Block timestamps drift.** Validators can nudge them by seconds. Irrelevant at
  day-scale intervals; worth knowing at the 60-second setting, which exists only
  for live demos.
- **Metadata is public by design.** The title, the schedule, and the fact that a
  vault exists are all visible. That visibility *is* part of the deterrent.
- **Not audited.** Built in one evening for a hackathon.

## License

MIT
