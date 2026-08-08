import puppeteer from "puppeteer-core";
const OUT = process.env.OUT_DIR;
const APP = "https://amsorrytola.github.io/deadlight/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const b = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--hide-scrollbars", "--force-device-scale-factor=2"],
  defaultViewport: { width: 1280, height: 800, deviceScaleFactor: 2 },
});
const p = await b.newPage();

async function shot(hash, name, scroll = 0, wait = 3500) {
  await p.goto(APP + hash, { waitUntil: "networkidle2", timeout: 90000 });
  await sleep(wait);
  if (scroll) {
    await p.evaluate((y) => window.scrollTo({ top: y }), scroll);
    await sleep(900);
  }
  await p.screenshot({ path: `${OUT}/shot-${name}.png` });
  console.log("  ▸", name);
}

await shot("", "01-home");
await shot("#/vault/0", "02-armed", 0);
await shot("#/vault/0", "03-sealed-console", 380);
await shot("#/vault/1", "04-released", 0);
await shot("#/vault/1", "05-document", 430);
await shot("#/how", "06-how");
await shot("#/arm", "07-arm");

await b.close();
console.log("shots done");
