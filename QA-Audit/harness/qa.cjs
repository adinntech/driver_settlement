/* QA harness: drives the isolated QA app (frontend :3100, backend :5100) in real Chrome; evidence = screenshots + logs. */
const puppeteer = require("puppeteer-core");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const FE = "http://localhost:3100";
const API = "http://localhost:5100/api";
const env = Object.fromEntries(fs.readFileSync(path.resolve(ROOT, "../backend/.env"), "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const CREDS = Object.fromEntries(["RSOP", "RBP", "RSOM", "RSA", "RSO"].map((r) => [r, { username: env[`${r}_USERNAME`], password: env[`${r}_PASSWORD`] }]));
const RESULTS = path.join(ROOT, "harness", "results.jsonl");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const todayIst = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const addDays = (ymd, n) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

async function apiLogin(role) {
  const r = await fetch(`${API}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role, ...CREDS[role] }) });
  return (await r.json()).data?.token;
}
async function api(role, method, p, body) {
  const t = await apiLogin(role);
  const r = await fetch(`${API}${p}`, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` }, body: body ? JSON.stringify(body) : undefined });
  const ct = r.headers.get("content-type") || "";
  return { status: r.status, json: ct.includes("json") ? await r.json() : null, buf: ct.includes("json") ? null : Buffer.from(await r.arrayBuffer()), ct, cd: r.headers.get("content-disposition") };
}

/** One scenario: browser + page + logs (step times are elapsed since the scenario started). */
class Session {
  constructor(name) {
    this.name = name;
    this.t0 = 0;
    this.console = [];
    this.network = [];
    this.steps = [];
    this.shots = 0;
  }
  async start({ width = 1440, height = 900 } = {}) {
    this.browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: [`--window-size=${width},${height}`] });
    this.page = await this.browser.newPage();
    await this.page.setViewport({ width, height });
    const dl = path.join(ROOT, "evidence", "downloads", this.name);
    fs.mkdirSync(dl, { recursive: true });
    this.downloadDir = dl;
    const cdp = await this.page.createCDPSession();
    await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: dl }).catch(() => cdp.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: dl }));
    this.page.on("console", (m) => { if (["error", "warning"].includes(m.type())) this.console.push({ t: this.ts(), type: m.type(), text: m.text().slice(0, 400), url: this.page.url() }); });
    this.page.on("pageerror", (e) => this.console.push({ t: this.ts(), type: "pageerror", text: e.message, url: this.page.url() }));
    this.page.on("response", async (r) => {
      if (!r.url().startsWith(API)) return;
      if (r.status() >= 400) {
        let body = "";
        try { body = (await r.text()).slice(0, 300); } catch {}
        this.network.push({ t: this.ts(), status: r.status(), method: r.request().method(), url: r.url().replace(API, ""), body });
      }
    });
    this.t0 = Date.now();
    return this;
  }
  ts() { const s = Math.max(0, Math.round((Date.now() - this.t0) / 1000)); return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; }
  log(msg) { const l = `[${this.ts()}] ${msg}`; this.steps.push(l); console.log(`  ${this.name} ${l}`); }
  async shot(label) {
    const f = path.join(ROOT, "evidence", "screenshots", `${this.name}--${String(++this.shots).padStart(2, "0")}-${label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`);
    await this.page.screenshot({ path: f, fullPage: false });
    return { file: path.relative(ROOT, f), at: this.ts() };
  }
  async stop() {
    await this.browser?.close();
  }
  // ---------------------------------------------------------------- navigation / auth
  async goto(p) { await this.page.goto(`${FE}${p}`, { waitUntil: "networkidle0" }); await sleep(300); }
  async uiLogin(role, creds = CREDS[role]) {
    await this.goto("/login");
    await this.page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await this.goto("/login");
    await this.clickText(".role-card strong", `${role} Login`);
    await this.page.waitForSelector(".login-form input[autocomplete=username]");
    await this.fillSel(".login-form input[autocomplete=username]", creds.username);
    await this.fillSel(".login-form input[type=password]", creds.password);
    await this.page.click(".login-form button.btn-primary");
    await sleep(1200);
    await this.page.waitForNetworkIdle({ idleTime: 400 }).catch(() => {});
  }
  async logout() { await this.page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); }); }
  // ---------------------------------------------------------------- generic interactions
  async clickText(selector, text, { exact = false, nth = 0 } = {}) {
    const ok = await this.page.evaluate((sel, txt, exact, nth) => {
      const els = [...document.querySelectorAll(sel)].filter((e) => { const t = (e.textContent || "").trim(); return exact ? t === txt : t.includes(txt); });
      const el = els[nth];
      if (!el) return false;
      (el.closest("button,a,[role=option],li,label") || el).scrollIntoView({ block: "center" });
      (el.closest("button,a,[role=option],li") || el).click();
      return true;
    }, selector, text, exact, nth);
    if (!ok) throw new Error(`clickText: no "${text}" in ${selector}`);
    await sleep(250);
  }
  async fillSel(selector, value) {
    await this.page.click(selector, { clickCount: 3 });
    await this.page.keyboard.press("Backspace");
    if (value !== "") await this.page.type(selector, String(value), { delay: 12 });
  }
  /** a <label class="field"><span>Label</span>…control</label> or any label containing the text */
  async fieldHandle(label, kind = "input") {
    const h = await this.page.evaluateHandle((label, kind) => {
      const labs = [...document.querySelectorAll("label")].filter((l) => (l.querySelector("span")?.textContent || l.firstChild?.textContent || l.textContent || "").trim().replace(/\s*\*$/, "").startsWith(label.replace(/\s*\*$/, "")));
      const q = (root) => (!root ? null : kind === "select" ? root.querySelector(".ui-select-trigger") : kind === "date" ? root.querySelector(".ui-date-trigger") : root.querySelector("input:not(.ui-native):not([type=checkbox]),textarea"));
      for (const l of labs) {
        const el = q(l) ?? q(l.nextElementSibling); // <label>X</label><div class="b-ctl">control</div> layouts
        if (el) return el;
      }
      return null;
    }, label, kind);
    const el = h.asElement();
    if (!el) throw new Error(`field "${label}" (${kind}) not found`);
    return el;
  }
  async fill(label, value) {
    const el = await this.fieldHandle(label);
    await el.click();
    await this.page.keyboard.down("Control"); await this.page.keyboard.press("KeyA"); await this.page.keyboard.up("Control");
    await this.page.keyboard.press("Backspace");
    if (value !== "") await el.type(String(value), { delay: 10 });
    const got = await el.evaluate((i) => i.value);
    if (String(got).replace(/[,\s]/g, "") !== String(value).replace(/[,\s]/g, "")) throw new Error(`fill("${label}"): typed "${value}" but the field holds "${got}"`);
  }
  /** custom Select: open, click the option by its text */
  async pick(labelOrTrigger, optionText) {
    const el = typeof labelOrTrigger === "string" ? await this.fieldHandle(labelOrTrigger, "select") : labelOrTrigger;
    await el.click();
    await this.page.waitForSelector(".ui-select-pop .ui-opt", { timeout: 4000 });
    await this.clickText(".ui-select-pop .ui-opt span", optionText, { exact: true });
  }
  async pickByAria(aria, optionText) {
    const el = await this.page.$(`.ui-select-trigger[aria-label="${aria}"]`);
    if (!el) throw new Error(`select [${aria}] not found`);
    return this.pick(el, optionText);
  }
  /** custom DateInput: open the calendar and walk with the keyboard to the target day, Enter */
  async date(labelOrTrigger, ymd) {
    const el = typeof labelOrTrigger === "string" ? await this.fieldHandle(labelOrTrigger, "date") : labelOrTrigger;
    const cur = await el.evaluate((b) => b.parentElement.querySelector("input.ui-native")?.value || "");
    await el.click();
    await this.page.waitForSelector(".ui-cal", { timeout: 4000 });
    const start = cur || todayIst();
    const diff = Math.round((Date.parse(`${ymd}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000);
    const key = diff >= 0 ? "ArrowRight" : "ArrowLeft";
    for (let i = 0; i < Math.abs(diff); i++) await this.page.keyboard.press(key);
    await this.page.keyboard.press("Enter");
    await sleep(150);
  }
  async dateByAria(aria, ymd) {
    const el = await this.page.$(`.ui-date-trigger[aria-label^="${aria}"]`);
    if (!el) throw new Error(`date [${aria}] not found`);
    return this.date(el, ymd);
  }
  async text(selector = "body") { return this.page.$eval(selector, (e) => e.innerText).catch(() => ""); }
  async has(text) { return (await this.text()).includes(text); }
  async toast() { await sleep(300); return this.page.$$eval(".toast", (t) => t.map((x) => x.textContent.trim())).catch(() => []); }
  async waitIdle(ms = 400) { await this.page.waitForNetworkIdle({ idleTime: ms, timeout: 15000 }).catch(() => {}); }
}

/** Runs one test case inside a session; records PASS / FAIL / BLOCKED with evidence. */
async function tc(s, id, title, role, fn) {
  const rec = { id, title, role, scenario: s.name, start: s.ts(), status: "PASS", notes: [], evidence: [] };
  const ctx = {
    note: (m) => { rec.notes.push(m); s.log(`${id} · ${m}`); },
    shot: async (l) => { const e = await s.shot(`${id}-${l}`); rec.evidence.push(e); return e; },
    expect: (cond, msg) => { if (!cond) throw Object.assign(new Error(msg), { qa: "FAIL" }); },
    blocked: (msg) => { throw Object.assign(new Error(msg), { qa: "BLOCKED" }); },
  };
  const c0 = s.console.length;
  const n0 = s.network.length;
  s.log(`${id} START ${title}`);
  try {
    await fn(ctx);
  } catch (e) {
    rec.status = e.qa ?? "FAIL";
    rec.notes.push(`${rec.status === "BLOCKED" ? "Blocked" : "Failure"}: ${e.message}`);
    try { rec.evidence.push(await s.shot(`${id}-${rec.status.toLowerCase()}`)); } catch {}
  }
  rec.end = s.ts();
  rec.console = s.console.slice(c0).filter((x) => x.type !== "warning");
  rec.apiErrors = s.network.slice(n0);
  s.log(`${id} ${rec.status}${rec.notes.length ? ` — ${rec.notes[rec.notes.length - 1]}` : ""}`);
  fs.appendFileSync(RESULTS, JSON.stringify(rec) + "\n");
  return rec;
}

async function scenario(name, fn, opts) {
  const s = new Session(name);
  await s.start(opts);
  try {
    await fn(s);
  } catch (e) {
    console.error(`scenario ${name} crashed: ${e.stack}`);
    fs.appendFileSync(RESULTS, JSON.stringify({ id: `${name}-CRASH`, title: `Scenario crashed: ${e.message}`, scenario: name, status: "BLOCKED", notes: [e.stack?.slice(0, 500)] }) + "\n");
  } finally {
    await s.stop();
    fs.writeFileSync(path.join(ROOT, "evidence", "api", `${name}-console-and-api-errors.json`), JSON.stringify({ console: s.console, network: s.network, steps: s.steps }, null, 2));
  }
}

module.exports = { Session, tc, scenario, api, apiLogin, CREDS, FE, API, ROOT, sleep, todayIst, addDays };
