# Devfolio submission — DEADLIGHT

**Hackathon:** Road to Devcon (IIT Roorkee)
**Tracks:** Censorship Resistance (primary) · Self-Sovereignty (secondary)

---

## Name

DEADLIGHT

## Tagline

Silencing the author is what publishes the document.

## Short description (≤ 240 chars)

A censorship-resistant dead man's switch. The ciphertext lives entirely on-chain and the key is Shamir-split across guardians — but the contract refuses to open it while the publisher checks in. Go silent and it publishes itself.

## The problem

Every "uncensorable publishing" tool has the same hole in it: someone has to be
holding the material, and that someone can be reached.

- Publish now and you are the target before anyone has read it.
- Give it to a journalist and the leverage moves to them — a court order, a raid,
  an editor who folds.
- Encrypt and hand out the key and any keyholder can be compelled to open it
  early, or paid to.
- Put it on IPFS and the pin lapses, the gateway blocks, the CID gets filtered.
  Availability is a promise, not a property.

The common failure is that **suppression works**. Pressure applied to the right
person at the right moment makes the document not exist.

## What DEADLIGHT does

It makes suppression counterproductive. The document is armed to release on
*silence*, so detaining the publisher does not prevent publication — it causes
it. The adversary's rational move flips from "silence them" to "keep them free
and checking in," which is exactly what the publisher wanted.

The part that makes this more than a UX gimmick: **the embargo is enforced by the
contract, not promised by the guardians.** `submitShare` reverts while the
countdown is alive. Every guardian could collude, or be served by the same court
on the same morning, and the document still would not open a second early. In the
demo we prove this on-camera by submitting a genuine, valid share and watching
the chain refuse it with `StillAlive`.

Symmetrically, `heartbeat` and `revoke` both stop working the instant the
deadline lapses — so a captor who seizes the publisher's key *after* the fact
cannot bury the release either. There is no configuration of coercion that puts
the genie back.

## How it works

1. A 256-bit key is generated in the browser; the document is sealed with
   AES-256-GCM and the ciphertext is written into **contract storage** — not a
   gateway, not a pin. There is no host to subpoena.
2. The key is split with Shamir's scheme over GF(2⁸) into `n` shares, any `k` of
   which rebuild it. Below `k`, the shares are information-theoretically blind.
   The assembled key is zeroed before the transaction is even signed.
3. Only `keccak256(share)` goes on-chain — enough to prove a share is genuine on
   arrival, useless for reconstructing anything beforehand.
4. The publisher sends a `heartbeat` each interval. While it is alive, the
   contract rejects every share.
5. Miss one check-in and submission opens permanently and permissionlessly — the
   commitment check is the only gate, so a silenced guardian can hand their share
   to a stranger and the release still happens.
6. At `k` shares, every visitor's browser reconstructs the key and decrypts
   locally. No server is involved in the reveal.

## Self-sovereignty

The app generates a burner key in the browser and stores it in `localStorage` —
no account, no extension, no KYC, nothing tying the publisher to an identity. A
browser wallet is supported but never required. Reading a released vault needs no
key at all, and `revoke` preserves the author's right to withdraw their own words
— but only from a position of freedom.

## Challenges we ran into

- **Getting the embargo semantics right.** The first design let the publisher
  heartbeat at any time, which quietly broke the whole guarantee: a captor with
  the publisher's key could keep the switch alive forever. Both `heartbeat` and
  `revoke` now hard-revert past the deadline.
- **Making the guarantee demonstrable rather than asserted.** We added a console
  that lets anyone attempt an early release with a real share, so the revert is
  visible instead of being something the README claims.
- **On-chain storage economics.** Contract storage runs ~20k gas per 32 bytes, so
  documents are capped at 8 KB here; production belongs in EIP-4844 blobs with
  only the hash in state.
- **Stack-too-deep** in the Solidity vault struct, resolved with `via_ir`.

## Technologies

Solidity · Foundry (13 tests incl. fuzz) · Ethereum Sepolia · React · TypeScript ·
Vite · ethers v6 · WebCrypto (AES-256-GCM) · Shamir secret sharing over GF(2⁸),
implemented from scratch with no dependencies

## Links

- **Live app:** https://amsorrytola.github.io/deadlight/
- **Source:** https://github.com/amsorrytola/deadlight
- **Contract (Sepolia):** https://sepolia.etherscan.io/address/0xd4aC45705278Bb49aBdbF938ee596dE29fB0Be92
- **Demo video:** https://amsorrytola.github.io/deadlight/demo.mp4

## Honest limits

8 KB document cap; guardians must actually retain their shares (lose more than
`n − k` and it is sealed forever); block timestamps drift by seconds, which is
irrelevant at day-scale intervals and worth knowing at the 60-second demo
setting; vault metadata is public by design. Not audited — built in one evening.
