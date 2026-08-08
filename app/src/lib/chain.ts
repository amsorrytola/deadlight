import { BrowserProvider, Contract, JsonRpcProvider, Wallet, formatEther, type Signer } from "ethers";
import { DEPLOYMENT } from "./deployment";

export const ABI = [
  "function arm(string title, string mimeType, bytes iv, bytes ciphertext, bytes32[] shareCommits, uint8 threshold, uint32 interval) returns (uint256)",
  "function heartbeat(uint256 id)",
  "function revoke(uint256 id)",
  "function submitShare(uint256 id, uint8 index, bytes share)",
  "function vaultCount() view returns (uint256)",
  "function vaultInfo(uint256 id) view returns (address publisher, uint64 deadline, uint32 interval, uint8 threshold, uint8 shareCount, uint8 revealedCount, bool revoked, bool unlocked, uint64 armedAt, uint64 lastHeartbeat, string title, string mimeType, uint256 ciphertextLength)",
  "function ciphertextOf(uint256 id) view returns (bytes iv, bytes ciphertext)",
  "function commitmentsOf(uint256 id) view returns (bytes32[])",
  "function revealedShares(uint256 id) view returns (uint8[] indices, bytes[] shares)",
  "function isUnlocked(uint256 id) view returns (bool)",
  "function timeRemaining(uint256 id) view returns (uint64)",
  "event VaultArmed(uint256 indexed id, address indexed publisher, string title, uint8 threshold, uint8 shareCount, uint64 deadline)",
  "event Heartbeat(uint256 indexed id, address indexed publisher, uint64 newDeadline)",
  "event ShareRevealed(uint256 indexed id, uint8 indexed index, address indexed submitter, uint8 revealedCount)",
  "event Unlocked(uint256 indexed id, uint64 at)",
  "event Revoked(uint256 indexed id)",
];

export const readProvider = new JsonRpcProvider(DEPLOYMENT.rpcUrl, DEPLOYMENT.chainId, {
  staticNetwork: true,
});

export function readContract(): Contract {
  return new Contract(DEPLOYMENT.address, ABI, readProvider);
}

export function writeContract(signer: Signer): Contract {
  return new Contract(DEPLOYMENT.address, ABI, signer);
}

/*//////////////////////////////////////////////////////////////
                        SELF-CUSTODIED KEY
//////////////////////////////////////////////////////////////*/

const BURNER_KEY = "deadlight.burner.v1";

/**
 * A key the app generates and the browser keeps. No extension, no custodian, no
 * account — which is the point: a publisher in a hostile jurisdiction should not
 * have to install identifiable software or touch a KYC'd wallet to arm a switch.
 */
export function loadBurner(): Wallet {
  let pk = localStorage.getItem(BURNER_KEY);
  if (!pk) {
    pk = Wallet.createRandom().privateKey;
    localStorage.setItem(BURNER_KEY, pk);
  }
  return new Wallet(pk, readProvider);
}

export function importBurner(privateKey: string): Wallet {
  const w = new Wallet(privateKey.trim(), readProvider); // throws on malformed key
  localStorage.setItem(BURNER_KEY, w.privateKey);
  return w;
}

export function resetBurner(): Wallet {
  const w = Wallet.createRandom();
  localStorage.setItem(BURNER_KEY, w.privateKey);
  return new Wallet(w.privateKey, readProvider);
}

export async function connectInjected(): Promise<Signer> {
  const eth = (window as unknown as { ethereum?: any }).ethereum;
  if (!eth) throw new Error("No browser wallet found. Use the built-in burner key instead.");
  const provider = new BrowserProvider(eth);
  await provider.send("eth_requestAccounts", []);
  const net = await provider.getNetwork();
  if (Number(net.chainId) !== DEPLOYMENT.chainId) {
    try {
      await provider.send("wallet_switchEthereumChain", [{ chainId: "0x" + DEPLOYMENT.chainId.toString(16) }]);
    } catch {
      throw new Error(`Switch your wallet to ${DEPLOYMENT.chainName} (chain ${DEPLOYMENT.chainId}).`);
    }
  }
  return provider.getSigner();
}

export async function balanceOf(address: string): Promise<string> {
  const wei = await readProvider.getBalance(address);
  const s = formatEther(wei);
  const n = Number(s);
  return n === 0 ? "0" : n < 0.0001 ? "<0.0001" : n.toFixed(4);
}

export function explorerTx(hash: string): string {
  return `${DEPLOYMENT.explorer}/tx/${hash}`;
}

export function explorerAddress(addr: string): string {
  return `${DEPLOYMENT.explorer}/address/${addr}`;
}

/*//////////////////////////////////////////////////////////////
                             VAULT MODEL
//////////////////////////////////////////////////////////////*/

export type Vault = {
  id: number;
  publisher: string;
  deadline: number;
  interval: number;
  threshold: number;
  shareCount: number;
  revealedCount: number;
  revoked: boolean;
  unlocked: boolean;
  armedAt: number;
  lastHeartbeat: number;
  title: string;
  mimeType: string;
  ciphertextLength: number;
};

export async function fetchVault(id: number): Promise<Vault> {
  const c = readContract();
  const v = await c.vaultInfo(id);
  return {
    id,
    publisher: v[0],
    deadline: Number(v[1]),
    interval: Number(v[2]),
    threshold: Number(v[3]),
    shareCount: Number(v[4]),
    revealedCount: Number(v[5]),
    revoked: v[6],
    unlocked: v[7],
    armedAt: Number(v[8]),
    lastHeartbeat: Number(v[9]),
    title: v[10],
    mimeType: v[11],
    ciphertextLength: Number(v[12]),
  };
}

export async function fetchAllVaults(): Promise<Vault[]> {
  const c = readContract();
  const count = Number(await c.vaultCount());
  const ids = Array.from({ length: count }, (_, i) => count - 1 - i); // newest first
  return Promise.all(ids.map(fetchVault));
}

export type VaultState = "armed" | "lapsed" | "unlocked" | "revoked";

export function vaultState(v: Vault, now: number): VaultState {
  if (v.revoked) return "revoked";
  if (v.unlocked) return "unlocked";
  return now >= v.deadline ? "lapsed" : "armed";
}
