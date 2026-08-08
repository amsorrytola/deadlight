import type { VaultState } from "./lib/chain";

export function short(a: string): string {
  return a.slice(0, 6) + "…" + a.slice(-4);
}

export function fmtTime(ts: number): string {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Countdown formatting: the closer to zero, the more precise it gets. */
export function fmtDur(secs: number): string {
  if (secs <= 0) return "00:00:00";
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return d > 0 ? `${d}d ${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(h)}:${pad(m)}:${pad(s)}`;
}

export function fmtInterval(secs: number): string {
  if (secs % 86400 === 0 && secs >= 86400) return `${secs / 86400} day${secs === 86400 ? "" : "s"}`;
  if (secs % 3600 === 0 && secs >= 3600) return `${secs / 3600} hour${secs === 3600 ? "" : "s"}`;
  if (secs % 60 === 0 && secs >= 60) return `${secs / 60} min`;
  return `${secs}s`;
}

export function StateBadge({ state }: { state: VaultState }) {
  const label = {
    armed: "● Armed",
    lapsed: "● Silence — releasing",
    unlocked: "● In the open",
    revoked: "● Stood down",
  }[state];
  return <span className={`badge ${state}`}>{label}</span>;
}

export function Dial({ frac, value, label }: { frac: number; value: string; label: string }) {
  const R = 56;
  const C = 2 * Math.PI * R;
  const clamped = Math.max(0, Math.min(1, frac));
  const hot = clamped < 0.2;
  return (
    <div className="dial">
      <svg width="128" height="128" viewBox="0 0 128 128">
        <circle cx="64" cy="64" r={R} fill="none" stroke="var(--line)" strokeWidth="6" />
        <circle
          cx="64"
          cy="64"
          r={R}
          fill="none"
          stroke={clamped <= 0 ? "var(--red)" : hot ? "var(--red)" : "var(--amber)"}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - clamped)}
          style={{ transition: "stroke-dashoffset 1s linear, stroke .4s" }}
        />
      </svg>
      <div className="mid">
        <div>
          <div className="n">{value}</div>
          <div className="l">{label}</div>
        </div>
      </div>
    </div>
  );
}

export function Slots({ n, filled }: { n: number; filled: number[] }) {
  return (
    <div className="slots">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className={`slot${filled.includes(i) ? " filled" : ""}`} title={`Guardian ${i + 1}`}>
          {filled.includes(i) ? "✓" : i + 1}
        </div>
      ))}
    </div>
  );
}
