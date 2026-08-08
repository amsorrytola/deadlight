import { useCallback, useEffect, useState } from "react";
import type { Signer } from "ethers";
import { Wallet } from "ethers";
import {
  loadBurner,
  resetBurner,
  connectInjected,
  balanceOf,
  fetchAllVaults,
  vaultState,
  explorerAddress,
  type Vault,
} from "./lib/chain";
import { DEPLOYMENT } from "./lib/deployment";
import Arm from "./views/Arm";
import VaultDetail from "./views/VaultDetail";
import { Dial, Slots, StateBadge, fmtDur, fmtInterval, short } from "./components";

function useHash(): string {
  const [h, setH] = useState(() => location.hash || "#/");
  useEffect(() => {
    const on = () => setH(location.hash || "#/");
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return h;
}

export default function App() {
  const hash = useHash();
  const [signer, setSigner] = useState<Signer | null>(null);
  const [address, setAddress] = useState("");
  const [kind, setKind] = useState<"burner" | "wallet">("burner");
  const [bal, setBal] = useState("…");
  const [walletErr, setWalletErr] = useState("");

  // Default to a key this browser generated. No extension, no account, no trace
  // back to an identity — the same properties a publisher actually needs.
  useEffect(() => {
    const w: Wallet = loadBurner();
    setSigner(w);
    setAddress(w.address);
  }, []);

  const refreshBal = useCallback(async () => {
    if (!address) return;
    try {
      setBal(await balanceOf(address));
    } catch {
      setBal("?");
    }
  }, [address]);

  useEffect(() => {
    refreshBal();
    const t = window.setInterval(refreshBal, 12000);
    return () => window.clearInterval(t);
  }, [refreshBal]);

  async function useInjected() {
    setWalletErr("");
    try {
      const s = await connectInjected();
      setSigner(s);
      setAddress(await s.getAddress());
      setKind("wallet");
    } catch (e: any) {
      setWalletErr(e?.message || String(e));
    }
  }

  function newBurner() {
    const w = resetBurner();
    setSigner(w);
    setAddress(w.address);
    setKind("burner");
  }

  const route = hash.replace(/^#/, "");
  const vaultMatch = route.match(/^\/vault\/(\d+)/);

  return (
    <>
      <header className="top">
        <div className="top-inner">
          <a href="#/" className="brand">
            <span className="lamp" />
            DEADLIGHT
          </a>
          <nav className="tabs">
            <a href="#/" className={route === "/" || route === "" ? "on" : ""}>
              Vaults
            </a>
            <a href="#/arm" className={route === "/arm" ? "on" : ""}>
              Arm a switch
            </a>
            <a href="#/how" className={route === "/how" ? "on" : ""}>
              How it works
            </a>
          </nav>
          <div className="who" title={address}>
            <span style={{ color: kind === "burner" ? "var(--violet)" : "var(--amber)" }}>
              {kind === "burner" ? "burner" : "wallet"}
            </span>
            <b>{address ? short(address) : "…"}</b>
            <span className="bal">{bal} ETH</span>
          </div>
        </div>
      </header>

      <div className="wrap">
        {route === "/arm" ? (
          <Arm signer={signer} onArmed={(id) => (location.hash = `#/vault/${id}`)} />
        ) : vaultMatch ? (
          <VaultDetail id={Number(vaultMatch[1])} signer={signer} address={address} />
        ) : route === "/how" ? (
          <How />
        ) : (
          <Home />
        )}

        {/* ── identity / funding ─────────────────────────── */}
        <h2 className="sec">Your key</h2>
        <div className="card">
          <div className="row">
            <div>
              <dl className="kv">
                <dt>Type</dt>
                <dd>{kind === "burner" ? "Browser-generated burner (self-custodied)" : "Injected browser wallet"}</dd>
                <dt>Address</dt>
                <dd>
                  <a href={explorerAddress(address)} target="_blank" rel="noreferrer">
                    {address}
                  </a>
                </dd>
                <dt>Balance</dt>
                <dd>
                  {bal} {DEPLOYMENT.chainName} ETH
                </dd>
              </dl>
            </div>
            <div>
              <div className="btns" style={{ marginBottom: 12 }}>
                <button className="small" onClick={() => navigator.clipboard.writeText(address)}>
                  Copy address
                </button>
                <button className="small" onClick={refreshBal}>
                  Refresh
                </button>
                {kind === "burner" && (
                  <button className="small" onClick={newBurner}>
                    New burner
                  </button>
                )}
                {kind === "burner" && (
                  <button className="small" onClick={useInjected}>
                    Use browser wallet
                  </button>
                )}
              </div>
              <div className="note">
                The burner key is generated in your browser and stored only in this tab's localStorage. Fund it from
                any {DEPLOYMENT.chainName} faucet to arm a switch. Reading vaults needs no key at all.
              </div>
              {walletErr && (
                <div className="note bad" style={{ marginTop: 12 }}>
                  {walletErr}
                </div>
              )}
            </div>
          </div>
        </div>

        <footer className="bot">
          <div>
            DEADLIGHT — censorship-resistant dead man's switch · Road to Devcon, IIT Roorkee
          </div>
          <div>
            <a href={explorerAddress(DEPLOYMENT.address)} target="_blank" rel="noreferrer">
              contract {short(DEPLOYMENT.address)} on {DEPLOYMENT.chainName} ↗
            </a>
          </div>
        </footer>
      </div>
    </>
  );
}

/* ─────────────────────────────────────────────────────────── */

function Home() {
  const [vaults, setVaults] = useState<Vault[] | null>(null);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [err, setErr] = useState("");

  useEffect(() => {
    const load = () =>
      fetchAllVaults()
        .then(setVaults)
        .catch((e) => setErr(e?.message || String(e)));
    load();
    const p = window.setInterval(load, 8000);
    const t = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => {
      window.clearInterval(p);
      window.clearInterval(t);
    };
  }, []);

  return (
    <>
      <div className="hero">
        <div className="kicker">Dead man's switch · on-chain · no host to seize</div>
        <h1>
          Silencing the author is
          <br />
          what <em>publishes</em> the document.
        </h1>
        <p>
          A whistleblower seals a document. The ciphertext lives entirely in contract state — there is no server, no
          pin, no CDN, nothing anyone can take down. The key is shattered into shares held by guardians scattered
          across jurisdictions.
        </p>
        <p>
          While the publisher is free, they check in and the contract <b style={{ color: "var(--text)" }}>refuses
          every share submission</b> — so even colluding guardians cannot leak it early. The moment they go silent,
          the embargo lifts on its own and the document decrypts for the world.
        </p>
        <p style={{ color: "var(--amber)" }}>
          Arresting the publisher does not suppress the leak. It triggers it.
        </p>
        <div className="btns" style={{ marginTop: 26 }}>
          <a href="#/arm">
            <button className="primary">Arm a switch</button>
          </a>
          <a href="#/how">
            <button>How it works</button>
          </a>
        </div>
      </div>

      <h2 className="sec">Live vaults</h2>
      {err && <div className="note bad">Could not reach {DEPLOYMENT.chainName}: {err}</div>}
      {!vaults && !err && <div className="center-msg">Reading chain…</div>}
      {vaults?.length === 0 && <div className="center-msg">No vaults armed yet. Be the first.</div>}
      <div className="grid">
        {vaults?.map((v) => {
          const st = vaultState(v, now);
          const rem = Math.max(0, v.deadline - now);
          return (
            <a className="card link" href={`#/vault/${v.id}`} key={v.id}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginBottom: 14 }}>
                <StateBadge state={st} />
                <span style={{ color: "var(--dimmer)", fontSize: 11 }}>#{v.id}</span>
              </div>
              <div style={{ color: "var(--white)", fontSize: 16, marginBottom: 10, fontWeight: 600 }}>{v.title}</div>
              <div className="count" style={{ gap: 16 }}>
                <Dial
                  frac={st === "armed" ? rem / v.interval : 0}
                  value={st === "armed" ? String(Math.ceil(rem / 60)) : st === "unlocked" ? "◆" : "0"}
                  label={st === "armed" ? "min" : st === "unlocked" ? "open" : "lapsed"}
                />
                <div>
                  <div
                    style={{
                      fontSize: 19,
                      fontWeight: 700,
                      color: st === "armed" ? "var(--amber)" : st === "unlocked" ? "var(--white)" : "var(--red)",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {st === "armed" ? fmtDur(rem) : st === "unlocked" ? "RELEASED" : st === "revoked" ? "STOOD DOWN" : "SILENCE"}
                  </div>
                  <div style={{ color: "var(--dimmer)", fontSize: 11, marginTop: 4 }}>
                    {v.threshold}-of-{v.shareCount} · {fmtInterval(v.interval)} check-in
                  </div>
                  <div style={{ marginTop: 10 }}>
                    <Slots n={v.shareCount} filled={[]} />
                  </div>
                </div>
              </div>
              <div style={{ color: "var(--dimmer)", fontSize: 11, marginTop: 14 }}>
                by {short(v.publisher)} · {v.ciphertextLength} bytes on-chain
              </div>
            </a>
          );
        })}
      </div>
    </>
  );
}

function How() {
  return (
    <>
      <h2 className="sec">How it works</h2>
      <div className="card" style={{ marginBottom: 20 }}>
        <ol className="steps">
          <li>
            <b>The document never leaves your browser in the clear.</b>
            A 256-bit key is generated in the tab, the document is sealed with AES-256-GCM, and the ciphertext is
            written into contract storage. Not IPFS, not a pin, not a gateway — contract state. There is no host to
            subpoena and no pin to let lapse.
          </li>
          <li>
            <b>The key is shattered, then destroyed.</b>
            Shamir's scheme over GF(2⁸) splits it into n shares, any k of which rebuild it. Fewer than k reveal
            literally nothing — not a byte, not a bias. The assembled key is zeroed before the transaction is even
            signed, so no party in the system has ever held both halves of the secret.
          </li>
          <li>
            <b>Only commitments go on-chain.</b>
            The contract stores keccak256 of each share. That is enough to prove a share is genuine when it arrives,
            and useless for reconstructing anything before then.
          </li>
          <li>
            <b>The chain enforces the embargo.</b>
            While the countdown is alive, <code>submitShare</code> reverts. Every guardian could collude, or be
            compelled by the same court on the same morning, and the document still would not open. The censor's
            usual move — pressure the intermediaries — has no surface to push on.
          </li>
          <li>
            <b>Silence is the trigger.</b>
            Miss one check-in and submission opens permanently. Heartbeat and stand-down both stop working at the
            deadline, so seizing the publisher's key after the lapse cannot bury the release either. There is no
            configuration of coercion that puts the genie back.
          </li>
          <li>
            <b>Anyone can finish it.</b>
            Share submission is permissionless — the commitment check is the only gate. A guardian who is themselves
            silenced can hand their string to a stranger and the release still happens. At k shares, every visitor's
            browser reconstructs the key and decrypts independently.
          </li>
        </ol>
      </div>

      <h2 className="sec">What it costs an adversary</h2>
      <div className="card">
        <dl className="kv">
          <dt>Seize the host</dt>
          <dd>Nothing to seize. The ciphertext is contract state, replicated by every node.</dd>
          <dt>Detain the publisher</dt>
          <dd>Publishes the document. This is the intended failure mode.</dd>
          <dt>Compel the publisher's key</dt>
          <dd>Buys time only while they are free; after the lapse, the key does nothing.</dd>
          <dt>Compel every guardian</dt>
          <dd>Cannot open it early — the contract rejects shares before the deadline.</dd>
          <dt>Compel k guardians to stay silent</dt>
          <dd>
            The only real attack, and it is why you choose n and k across jurisdictions. Any single guardian can also
            delegate their share to an unknown party.
          </dd>
        </dl>
      </div>

      <h2 className="sec">Honest limits</h2>
      <div className="card">
        <p style={{ color: "var(--dim)", margin: "0 0 12px" }}>
          Contract storage is expensive, so documents here are capped at 8 KB — production would put ciphertext in
          blobs (EIP-4844) or calldata and keep only the hash in state. Guardians must actually keep their shares;
          losing more than n−k of them seals the document forever. And the deadline uses block timestamps, which
          validators can nudge by seconds — irrelevant at day-scale intervals, worth knowing at minute-scale.
        </p>
        <p style={{ color: "var(--dim)", margin: 0 }}>
          The 60-second interval exists for live demos. Do not arm anything real with it.
        </p>
      </div>
    </>
  );
}
