/** Final leg: submit the threshold share and record the reveal. */
import puppeteer from "puppeteer-core";
import fs from "node:fs";

const OUT = process.env.OUT_DIR;
const VAULT = process.env.VAULT_ID;
const shares = JSON.parse(fs.readFileSync(`${OUT}/shares.json`, "utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log("  ▸", ...a);

const browser = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--window-size=1280,720", "--hide-scrollbars", "--font-render-hinting=none"],
  defaultViewport: { width: 1280, height: 720 },
  protocolTimeout: 600000,
});
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("  ! pageerror:", e.message));
await page.evaluateOnNewDocument((pk) => {
  try {
    localStorage.setItem("deadlight.burner.v1", pk);
  } catch {}
}, process.env.DEMO_KEY);

await page.goto(`https://amsorrytola.github.io/deadlight/#/vault/${VAULT}`, { waitUntil: "networkidle2", timeout: 90000 });
await sleep(4000);

log("buttons:", JSON.stringify(await page.$$eval("button", (b) => b.map((x) => x.innerText.trim()))));
log("inputs:", await page.$$eval('input[type="text"]', (i) => i.length));

async function installOverlay() {
  await page.evaluate(() => {
    if (document.getElementById("__cap")) return;
    const s = document.createElement("style");
    s.textContent = `#__cap{position:fixed;left:0;right:0;bottom:0;z-index:99999;padding:26px 40px 30px;
      background:linear-gradient(0deg,rgba(4,5,7,.97) 55%,rgba(4,5,7,0));font-family:ui-monospace,Menlo,monospace;
      opacity:0;transition:opacity .35s;pointer-events:none}#__cap.on{opacity:1}
      #__cap .t{color:#f4f7fa;font-size:23px;line-height:1.4;font-weight:600;max-width:1080px}
      #__cap .s{color:#f0a020;font-size:14px;letter-spacing:.16em;text-transform:uppercase;margin-bottom:9px}`;
    document.head.appendChild(s);
    const d = document.createElement("div");
    d.id = "__cap";
    d.innerHTML = `<div class="s"></div><div class="t"></div>`;
    document.body.appendChild(d);
    window.__cap = (sub, text) => {
      const el = document.getElementById("__cap");
      el.querySelector(".s").textContent = sub || "";
      el.querySelector(".t").textContent = text || "";
      el.classList.add("on");
    };
    window.__capOff = () => document.getElementById("__cap").classList.remove("on");
  });
}
const cap = (s, t) => page.evaluate((a, b) => window.__cap(a, b), s, t);
const capOff = () => page.evaluate(() => window.__capOff());

let rec = null;
const start = async (name) => {
  rec = await page.screencast({ path: `${OUT}/${name}.webm` });
  log("rec ▶", name);
};
const stop = async () => {
  if (rec) await rec.stop();
  rec = null;
};

/** Click the submit button inside the guardian console, however it is labelled. */
const clickPublish = async () => {
  const which = await page.evaluate(() => {
    const cards = [...document.querySelectorAll(".card")];
    const console_ = cards.find((c) => c.innerText.toUpperCase().includes("GUARDIAN CONSOLE"));
    const btn = console_
      ? [...console_.querySelectorAll("button")].pop()
      : [...document.querySelectorAll("button")].find((b) => b.innerText.toLowerCase().includes("publish"));
    if (!btn) return null;
    btn.click();
    return btn.innerText.trim();
  });
  if (!which) throw new Error("no publish button found");
  log("clicked:", JSON.stringify(which));
};

await installOverlay();
await page.evaluate(() => window.scrollTo({ top: 330 }));
await sleep(1200);

await start("09-release-2");
await cap("Guardian 2", "One more share and the threshold is met. Neither guardian needed anyone's permission.");
await page.click('input[type="text"]', { clickCount: 3 });
await page.type('input[type="text"]', shares[1], { delay: 8 });
await sleep(1000);
await capOff();
await clickPublish();
await sleep(9000);
await stop();

log("waiting for release…");
await page.waitForFunction(() => document.body.innerText.includes("RELEASED"), { timeout: 300000, polling: 1000 });
await page.waitForFunction(() => document.body.innerText.includes("pre-allocated"), { timeout: 120000, polling: 1000 });
await sleep(2500);

await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
await sleep(1500);
await installOverlay();
await start("10-revealed");
await cap("Released", "Nobody unsealed it. The publisher simply stopped checking in.");
await sleep(5500);
await page.evaluate(() => window.scrollTo({ top: 400, behavior: "smooth" }));
await sleep(1500);
await cap("Decrypted in the browser", "The key was reconstructed from chain data alone. No server was involved in the reveal.");
await sleep(7000);
await capOff();
await sleep(800);
await stop();

await page.goto("about:blank");
await page.setContent(`<html><body style="margin:0;background:#07080a;height:100vh;display:grid;place-items:center;
  font-family:ui-monospace,Menlo,monospace">
  <div style="text-align:center;line-height:2">
    <div style="color:#f4f7fa;font-size:38px;font-weight:700;letter-spacing:.3em;margin-bottom:8px">DEADLIGHT</div>
    <div style="color:#ff3b30;font-size:20px;margin-bottom:36px">Silence is the trigger.</div>
    <div style="color:#767f8b;font-size:15px">
      <span style="color:#f0a020">Live</span> &nbsp; amsorrytola.github.io/deadlight<br>
      <span style="color:#f0a020">Code</span> &nbsp; github.com/amsorrytola/deadlight<br>
      <span style="color:#f0a020">Contract</span> &nbsp; 0xd4aC45705278Bb49aBdbF938ee596dE29fB0Be92
    </div>
    <div style="color:#4a525d;font-size:13px;margin-top:34px;letter-spacing:.12em">
      AES-256-GCM · Shamir k-of-n over GF(2⁸) · chain-enforced embargo
    </div>
  </div></body></html>`);
await sleep(900);
await page.screenshot({ path: `${OUT}/card-closing.png` });
log("closing card captured");
await browser.close();
console.log("DONE");
