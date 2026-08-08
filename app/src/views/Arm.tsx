import { useState } from "react";
import { keccak256 } from "ethers";
import type { Signer } from "ethers";
import { writeContract, explorerTx } from "../lib/chain";
import { randomKey, encrypt, enc, toHex, toB64 } from "../lib/crypto";
import { split } from "../lib/shamir";
import { fmtInterval } from "../components";

const MAX_BYTES = 8192; // on-chain storage is ~20k gas per 32 bytes — keep it sane

const INTERVALS = [
  { s: 60, label: "60 seconds — live demo" },
  { s: 300, label: "5 minutes" },
  { s: 3600, label: "1 hour" },
  { s: 86400, label: "24 hours" },
  { s: 604800, label: "7 days" },
  { s: 2592000, label: "30 days" },
];

type Packet = { index: number; b64: string };

export default function Arm({ signer, onArmed }: { signer: Signer | null; onArmed: (id: number) => void }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [mime, setMime] = useState("text/plain");
  const [n, setN] = useState(3);
  const [k, setK] = useState(2);
  const [interval, setInterval] = useState(60);

  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [packets, setPackets] = useState<Packet[] | null>(null);
  const [armedId, setArmedId] = useState<number | null>(null);
  const [txHash, setTxHash] = useState("");

  const bytes = new TextEncoder().encode(body).length;
  const tooBig = bytes > MAX_BYTES;

  async function onFile(f: File | undefined) {
    if (!f) return;
    const buf = new Uint8Array(await f.arrayBuffer());
    if (buf.length > MAX_BYTES) {
      setErr(`That file is ${buf.length} bytes; the on-chain cap here is ${MAX_BYTES}.`);
      return;
    }
    setErr("");
    setMime(f.type || "application/octet-stream");
    setTitle((t) => t || f.name);
    // Text files go in as text so the reveal renders; anything else as base64.
    if ((f.type || "").startsWith("text/") || f.name.endsWith(".md") || f.name.endsWith(".txt")) {
      setBody(new TextDecoder().decode(buf));
      setMime("text/plain");
    } else {
      setBody(toB64(buf));
      setErr("Binary file loaded as base64. It will download on release rather than render.");
    }
  }

  async function arm() {
    setErr("");
    if (!signer) return setErr("No signing key loaded.");
    if (!title.trim()) return setErr("Give it a public title — the world should see that something is sealed.");
    if (!body.trim()) return setErr("Nothing to seal.");
    if (tooBig) return setErr(`Document is ${bytes} bytes; cap is ${MAX_BYTES}.`);
    if (k > n || k < 1) return setErr("Threshold must be between 1 and the guardian count.");

    try {
      // 1. A key that exists only in this tab, for a few milliseconds.
      setBusy("Generating key…");
      const key = randomKey();

      setBusy("Encrypting (AES-256-GCM)…");
      const { iv, ciphertext } = await encrypt(key, enc.encode(body));

      // 2. Shatter it. From here on, no single party can rebuild the key.
      setBusy(`Splitting key ${k}-of-${n}…`);
      const shares = split(key, n, k);
      const commits = shares.map((s) => keccak256(s));
      key.fill(0); // the plaintext key is gone

      setBusy("Awaiting signature…");
      const c = writeContract(signer);
      const tx = await c.arm(title, mime, toHex(iv), toHex(ciphertext), commits, k, interval);

      setBusy("Sealing on-chain…");
      setTxHash(tx.hash);
      const rc = await tx.wait();

      let id = 0;
      for (const log of rc.logs) {
        try {
          const p = c.interface.parseLog(log);
          if (p?.name === "VaultArmed") {
            id = Number(p.args[0]);
            break;
          }
        } catch {
          /* not our event */
        }
      }

      setArmedId(id);
      setPackets(shares.map((s, i) => ({ index: i, b64: toB64(s) })));
      setBusy("");
    } catch (e: any) {
      setErr(e?.shortMessage || e?.message || String(e));
      setBusy("");
    }
  }

  function downloadPacket(p: Packet) {
    const url = `${location.origin}${location.pathname}#/vault/${armedId}`;
    const text = `DEADLIGHT — GUARDIAN PACKET
=================================================
Vault:      #${armedId}  "${title}"
Guardian:   ${p.index + 1} of ${n}
Threshold:  any ${k} guardians can release it

YOUR SHARE (keep it secret, keep it safe):

${p.b64}

-------------------------------------------------
WHAT TO DO

Nothing — for as long as the publisher keeps checking in.
The contract will physically refuse your share until the
deadline lapses, so you cannot leak this early even if you
are compelled to try.

If the publisher goes silent and the countdown hits zero,
open the vault and submit your share:

  ${url}

Once ${k} of ${n} shares are on-chain, the document decrypts
for everyone, forever. You do not need permission from
anyone — not from us, not from the publisher.
`;
    const blob = new Blob([text], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `deadlight-vault${armedId}-guardian${p.index + 1}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  if (packets && armedId !== null) {
    return (
      <>
        <h2 className="sec">Armed — vault #{armedId}</h2>
        <div className="note good" style={{ marginBottom: 20 }}>
          The document is sealed on-chain and the clock is running. Check in before the countdown hits zero, every
          time, forever — or it publishes itself.
        </div>

        <div className="note bad" style={{ marginBottom: 20 }}>
          These {n} shares are shown <b>once</b>. They were never sent anywhere and are not recoverable — not by this
          site, not from the chain. Hand each one to a different guardian now.
        </div>

        <div className="grid">
          {packets.map((p) => (
            <div className="card" key={p.index}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                <b style={{ color: "var(--white)" }}>Guardian {p.index + 1}</b>
                <span style={{ color: "var(--dimmer)", fontSize: 11 }}>
                  {k} of {n} releases
                </span>
              </div>
              <div className="mono-block" style={{ marginBottom: 12 }}>
                {p.b64}
              </div>
              <div className="btns">
                <button className="small" onClick={() => navigator.clipboard.writeText(p.b64)}>
                  Copy
                </button>
                <button className="small" onClick={() => downloadPacket(p)}>
                  Download packet
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="btns" style={{ marginTop: 26 }}>
          <button className="primary" onClick={() => onArmed(armedId)}>
            Open vault #{armedId} →
          </button>
          {txHash && (
            <a href={explorerTx(txHash)} target="_blank" rel="noreferrer">
              <button>View transaction ↗</button>
            </a>
          )}
        </div>
      </>
    );
  }

  return (
    <>
      <h2 className="sec">Arm a switch</h2>
      <div className="row" style={{ alignItems: "start" }}>
        <div className="card">
          <label className="field">
            <span>Public title</span>
            <input
              type="text"
              value={title}
              placeholder="Internal audit — Q3 remittances"
              onChange={(e) => setTitle(e.target.value)}
            />
            <span className="hint">
              Public from the moment you arm it. The threat is the existence of the vault, not just its contents.
            </span>
          </label>

          <label className="field">
            <span>The document</span>
            <textarea
              value={body}
              placeholder="Paste the thing they would silence you for…"
              onChange={(e) => setBody(e.target.value)}
            />
            <span className="hint" style={{ color: tooBig ? "var(--red)" : undefined }}>
              {bytes} / {MAX_BYTES} bytes — encrypted in this tab, stored in contract state.
            </span>
          </label>

          <label className="field">
            <span>…or load a file</span>
            <input type="file" onChange={(e) => onFile(e.target.files?.[0])} />
          </label>
        </div>

        <div className="card">
          <div className="row">
            <label className="field">
              <span>Guardians (n)</span>
              <input
                type="number"
                min={1}
                max={12}
                value={n}
                onChange={(e) => {
                  const v = Math.max(1, Math.min(12, Number(e.target.value) || 1));
                  setN(v);
                  if (k > v) setK(v);
                }}
              />
            </label>
            <label className="field">
              <span>Threshold (k)</span>
              <input
                type="number"
                min={1}
                max={n}
                value={k}
                onChange={(e) => setK(Math.max(1, Math.min(n, Number(e.target.value) || 1)))}
              />
            </label>
          </div>

          <div className="note" style={{ marginBottom: 18 }}>
            Any <b>{k}</b> of <b>{n}</b> guardians can release it. Fewer than {k} learn <b>nothing</b> — not a byte.
            Pick people who would not all fall under the same jurisdiction on the same day.
          </div>

          <label className="field">
            <span>Check-in interval</span>
            <select value={interval} onChange={(e) => setInterval(Number(e.target.value))}>
              {INTERVALS.map((i) => (
                <option key={i.s} value={i.s}>
                  {i.label}
                </option>
              ))}
            </select>
            <span className="hint">
              You must send a heartbeat every {fmtInterval(interval)}. Miss one and the release begins.
            </span>
          </label>

          {err && (
            <div className="note bad" style={{ marginBottom: 16 }}>
              {err}
            </div>
          )}

          <button className="primary" onClick={arm} disabled={!!busy || !signer}>
            {busy ? (
              <>
                <span className="spin">◐</span> {busy}
              </>
            ) : (
              "Encrypt, split & arm"
            )}
          </button>
          {txHash && busy && (
            <div style={{ marginTop: 12, fontSize: 11 }}>
              <a href={explorerTx(txHash)} target="_blank" rel="noreferrer">
                tx {txHash.slice(0, 18)}… ↗
              </a>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
