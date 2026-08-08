import { useCallback, useEffect, useState } from "react";
import { keccak256 } from "ethers";
import type { Signer } from "ethers";
import { readContract, writeContract, fetchVault, vaultState, explorerTx, explorerAddress, type Vault } from "../lib/chain";
import { combine } from "../lib/shamir";
import { decrypt, dec, fromHex, fromB64, toHex } from "../lib/crypto";
import { Dial, Slots, StateBadge, fmtDur, fmtInterval, fmtTime, short } from "../components";

export default function VaultDetail({
  id,
  signer,
  address,
}: {
  id: number;
  signer: Signer | null;
  address: string;
}) {
  const [v, setV] = useState<Vault | null>(null);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  const [tx, setTx] = useState("");
  const [shareInput, setShareInput] = useState("");
  const [plaintext, setPlaintext] = useState<string | null>(null);
  const [filled, setFilled] = useState<number[]>([]);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    try {
      const vault = await fetchVault(id);
      setV(vault);
      const c = readContract();
      const [indices] = await c.revealedShares(id);
      setFilled(indices.map((i: bigint | number) => Number(i)));
    } catch {
      setNotFound(true);
    }
  }, [id]);

  useEffect(() => {
    load();
    const p = window.setInterval(load, 5000);
    const t = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => {
      window.clearInterval(p);
      window.clearInterval(t);
    };
  }, [load]);

  // The moment the threshold is met, pull the shares and open it — no button,
  // no gatekeeper. Any visitor's browser does this independently.
  useEffect(() => {
    if (!v?.unlocked || plaintext !== null) return;
    (async () => {
      try {
        const c = readContract();
        const [, shares] = await c.revealedShares(id);
        const key = combine(shares.map((s: string) => fromHex(s)));
        const [iv, ct] = await c.ciphertextOf(id);
        const pt = await decrypt(key, fromHex(iv), fromHex(ct));
        setPlaintext(dec.decode(pt));
      } catch (e: any) {
        setErr("Reconstruction failed: " + (e?.message || String(e)));
      }
    })();
  }, [v?.unlocked, id, plaintext]);

  if (notFound) return <div className="center-msg">No vault #{id} on this contract.</div>;
  if (!v) return <div className="center-msg">Reading chain…</div>;

  const state = vaultState(v, now);
  const remaining = Math.max(0, v.deadline - now);
  const frac = v.interval > 0 ? remaining / v.interval : 0;
  const isPublisher = address && v.publisher.toLowerCase() === address.toLowerCase();

  async function send(label: string, fn: () => Promise<any>) {
    setErr("");
    setBusy(label);
    try {
      const t = await fn();
      setTx(t.hash);
      await t.wait();
      await load();
    } catch (e: any) {
      setErr(e?.shortMessage || e?.reason || e?.message || String(e));
    }
    setBusy("");
  }

  async function submitShare() {
    setErr("");
    let bytes: Uint8Array;
    try {
      bytes = fromB64(shareInput);
    } catch {
      return setErr("That is not a valid share — expected the base64 blob from a guardian packet.");
    }
    if (bytes.length < 2) return setErr("Share is truncated.");

    const index = bytes[0] - 1; // share x-coordinate is 1-based
    if (index < 0 || index >= v!.shareCount) return setErr(`Share claims guardian slot ${bytes[0]}, which does not exist.`);
    if (filled.includes(index)) return setErr(`Guardian ${index + 1}'s share is already on-chain.`);

    // Check the commitment locally first so nobody wastes gas on a bad paste.
    const c = readContract();
    const commits: string[] = await c.commitmentsOf(id);
    if (keccak256(bytes) !== commits[index]) {
      return setErr("This share does not match the commitment for that slot. Wrong vault, or it has been altered.");
    }

    if (!signer) return setErr("No signing key loaded.");
    await send(`Publishing guardian ${index + 1}'s share…`, () =>
      writeContract(signer).submitShare(id, index, toHex(bytes)),
    );
    setShareInput("");
  }

  function downloadBinary() {
    if (!plaintext) return;
    const bytes = fromB64(plaintext);
    const blob = new Blob([bytes as BufferSource], { type: v!.mimeType });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = v!.title.replace(/[^\w.-]+/g, "_") || "deadlight-release";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", marginBottom: 6 }}>
        <a href="#/" style={{ color: "var(--dimmer)", fontSize: 12 }}>
          ← all vaults
        </a>
        <StateBadge state={state} />
      </div>

      <h1 style={{ fontSize: 30, margin: "6px 0 22px", color: "var(--white)", letterSpacing: "-0.02em" }}>
        {v.title}
      </h1>

      {/* ── the clock ───────────────────────────────────── */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="count">
          <Dial
            frac={state === "armed" ? frac : 0}
            value={state === "armed" ? String(Math.ceil(remaining / 60)) : "0"}
            label={state === "armed" ? "min left" : "lapsed"}
          />
          <div style={{ flex: 1, minWidth: 240 }}>
            {state === "armed" && (
              <>
                <div className={`clock${frac < 0.2 ? " hot" : ""}`}>{fmtDur(remaining)}</div>
                <div style={{ color: "var(--dim)", fontSize: 12.5, marginTop: 6 }}>
                  until silence releases this document. The publisher last checked in {fmtTime(v.lastHeartbeat)}.
                </div>
              </>
            )}
            {state === "lapsed" && (
              <>
                <div className="clock done">SILENCE</div>
                <div style={{ color: "var(--dim)", fontSize: 12.5, marginTop: 6 }}>
                  The publisher missed their check-in. Share submission is <b style={{ color: "var(--red)" }}>open</b>.
                  {" "}
                  {v.threshold - v.revealedCount > 0
                    ? `${v.threshold - v.revealedCount} more share${v.threshold - v.revealedCount === 1 ? "" : "s"} and it belongs to everyone.`
                    : ""}
                </div>
              </>
            )}
            {state === "unlocked" && (
              <>
                <div className="clock" style={{ color: "var(--white)" }}>
                  RELEASED
                </div>
                <div style={{ color: "var(--dim)", fontSize: 12.5, marginTop: 6 }}>
                  {v.revealedCount} of {v.shareCount} guardians published. The key is reconstructed in your browser —
                  not on a server, not by us.
                </div>
              </>
            )}
            {state === "revoked" && (
              <>
                <div className="clock" style={{ color: "var(--dimmer)" }}>
                  STOOD DOWN
                </div>
                <div style={{ color: "var(--dim)", fontSize: 12.5, marginTop: 6 }}>
                  The publisher withdrew this while still free. It can never open. The ciphertext stays on-chain,
                  unreadable forever.
                </div>
              </>
            )}

            <div style={{ marginTop: 18 }}>
              <div style={{ fontSize: 10, letterSpacing: "0.16em", color: "var(--dimmer)", marginBottom: 6 }}>
                GUARDIAN SHARES — {v.revealedCount}/{v.threshold} NEEDED
              </div>
              <Slots n={v.shareCount} filled={filled} />
            </div>
          </div>
        </div>
      </div>

      {/* ── publisher controls ──────────────────────────── */}
      {isPublisher && (state === "armed" || state === "lapsed") && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, letterSpacing: "0.16em", color: "var(--dim)", marginBottom: 12 }}>
            YOU ARMED THIS
          </div>
          {state === "armed" ? (
            <>
              <div className="btns">
                <button
                  className="primary"
                  disabled={!!busy}
                  onClick={() => send("Checking in…", () => writeContract(signer!).heartbeat(id))}
                >
                  {busy ? <><span className="spin">◐</span> {busy}</> : "◉ I'm still here — check in"}
                </button>
                <button
                  className="danger"
                  disabled={!!busy}
                  onClick={() => send("Standing down…", () => writeContract(signer!).revoke(id))}
                >
                  Stand down permanently
                </button>
              </div>
              <div style={{ color: "var(--dimmer)", fontSize: 11.5, marginTop: 12 }}>
                Each check-in buys another {fmtInterval(v.interval)}. Both actions become impossible the instant the
                countdown hits zero — a captor holding your key cannot bury this after the fact.
              </div>
            </>
          ) : (
            <div className="note bad">
              Too late. The deadline lapsed, so heartbeat and stand-down are both locked out by the contract. This is
              deliberate: coercion after the fact must not be able to stop the release.
            </div>
          )}
        </div>
      )}

      {/* ── guardian console ────────────────────────────── */}
      {state === "lapsed" && (
        <div className="card" style={{ marginBottom: 20, borderColor: "rgba(255,59,48,.35)" }}>
          <div style={{ fontSize: 11, letterSpacing: "0.16em", color: "var(--red)", marginBottom: 12 }}>
            GUARDIAN CONSOLE — RELEASE OPEN
          </div>
          <label className="field">
            <span>Paste your share</span>
            <input
              type="text"
              value={shareInput}
              placeholder="base64 share from your guardian packet"
              onChange={(e) => setShareInput(e.target.value)}
            />
            <span className="hint">
              Verified against the on-chain commitment in your browser before any gas is spent. Anyone can submit —
              if you are silenced too, hand this string to someone who isn't.
            </span>
          </label>
          <button className="primary" onClick={submitShare} disabled={!!busy || !shareInput.trim()}>
            {busy ? <><span className="spin">◐</span> {busy}</> : "Publish share"}
          </button>
        </div>
      )}

      {/* ── the reveal ──────────────────────────────────── */}
      {state === "unlocked" && (
        <div className="reveal" style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, letterSpacing: "0.2em", color: "var(--dimmer)", marginBottom: 14 }}>
            ▼ DECRYPTED IN YOUR BROWSER
          </div>
          {plaintext === null ? (
            <div style={{ color: "var(--dim)" }}>
              <span className="spin">◐</span> Reconstructing key from {v.revealedCount} shares…
            </div>
          ) : v.mimeType === "text/plain" ? (
            <pre>{plaintext}</pre>
          ) : (
            <div>
              <p style={{ color: "var(--dim)" }}>
                {v.mimeType} — {v.ciphertextLength} bytes on-chain.
              </p>
              <button className="primary" onClick={downloadBinary}>
                Download released file
              </button>
            </div>
          )}
        </div>
      )}

      {err && (
        <div className="note bad" style={{ marginBottom: 20 }}>
          {err}
        </div>
      )}
      {tx && (
        <div className="note" style={{ marginBottom: 20 }}>
          <a href={explorerTx(tx)} target="_blank" rel="noreferrer">
            Transaction {tx.slice(0, 20)}… ↗
          </a>
        </div>
      )}

      {/* ── provenance ──────────────────────────────────── */}
      <h2 className="sec">On-chain record</h2>
      <div className="card">
        <dl className="kv">
          <dt>Vault</dt>
          <dd>#{v.id}</dd>
          <dt>Publisher</dt>
          <dd>
            <a href={explorerAddress(v.publisher)} target="_blank" rel="noreferrer">
              {short(v.publisher)}
            </a>
            {isPublisher && <span style={{ color: "var(--amber)" }}> — you</span>}
          </dd>
          <dt>Armed</dt>
          <dd>{fmtTime(v.armedAt)}</dd>
          <dt>Interval</dt>
          <dd>{fmtInterval(v.interval)} per check-in</dd>
          <dt>Deadline</dt>
          <dd>{fmtTime(v.deadline)}</dd>
          <dt>Scheme</dt>
          <dd>
            AES-256-GCM · Shamir {v.threshold}-of-{v.shareCount} over GF(2⁸)
          </dd>
          <dt>Ciphertext</dt>
          <dd>{v.ciphertextLength} bytes in contract storage — no IPFS, no pin, no host</dd>
        </dl>
      </div>
    </>
  );
}
