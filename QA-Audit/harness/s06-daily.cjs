const fs = require("fs");
const { scenario, tc, sleep, api, addDays } = require("./qa.cjs");
const state = JSON.parse(fs.readFileSync("./state.json", "utf8"));
const TK = state.roadshow.trackup; const D1 = "2026-11-26", D2 = "2026-11-27";
const S = (sel) => `.dsf ${sel}`;
async function openDaily(s) {
  await s.goto("/rbp/payments/new?type=daily");
  await s.page.type('input[aria-label="Search projects"]', TK.slice(3, 8), { delay: 25 });
  await sleep(900); await s.waitIdle();
  await s.clickText("table tbody tr a", "Select");
  await sleep(1200); await s.waitIdle();
}
const save = async (s) => { await s.clickText(".dsf-actions button", "Save", { exact: true }); await sleep(900); };
const err = async (s) => (await s.text(".dsf > .alert[role=alert]")).replace(/\n/g, " | ");
(async () => {
  await scenario("S06-daily-payments", async (s) => {
    await s.uiLogin("RBP");
    await tc(s, "DP-01", "Daily form loads the project context (job sheet, vehicle, client, driver) from records", "RBP", async (t) => {
      await openDaily(s);
      const job = await s.text(".vp-job");
      t.note(job.replace(/\n/g, " | "));
      t.expect(job.includes(TK) && job.includes(state.allot.vehicleNo) && /Mohd\. Arif Khan/.test(job), "context not loaded");
      await t.shot("context");
    });
    await tc(s, "DP-02", "Save with no amounts is refused", "RBP", async (t) => {
      await save(s);
      const e = await err(s); t.note(e);
      t.expect(/at least one amount/i.test(e), "empty payment accepted");
    });
    await tc(s, "DP-03", "A typed fuel cost that was not added with + is flagged; bunk name is required", "RBP", async (t) => {
      await s.page.type('input[aria-label="Fuel cost"]', "2500");
      await s.page.click('button[aria-label="Add diesel entry"]'); await sleep(300);
      const e1 = await err(s); t.note(`+ without bunk: ${e1}`);
      t.expect(/bunk name/i.test(e1), "bunk name not required");
      await save(s);
      const e2 = await err(s); t.note(`save with pending diesel: ${e2}`);
      t.expect(/Click \+ to add/i.test(e2), "pending diesel not flagged");
      await t.shot("diesel-pending");
    });
    await tc(s, "DP-04", "Expenses: Others needs a description; duplicates are refused; totals and Total Payable are exact", "RBP", async (t) => {
      await s.page.type('input[aria-label="Bunk name"]', "QA Fuels T Nagar");
      await s.page.click('button[aria-label="Add diesel entry"]'); await sleep(300);
      await s.dateByAria("From Date", D1); await s.dateByAria("To Date", D1);
      await s.page.type('input[aria-label="Food"]', "400");
      await s.page.type('input[aria-label="Salary Advance"]', "1000");
      await s.pickByAria("Expense detail", "Toll");
      await s.page.type('input[aria-label="Expense amount"]', "150");
      await s.clickText(".vp-exp-foot button", "Add");
      await s.pickByAria("Expense detail", "Toll");
      await s.page.type('input[aria-label="Expense amount"]', "150");
      await s.clickText(".vp-exp-foot button", "Add");
      const dup = await err(s); t.note(`duplicate: ${dup}`);
      t.expect(/already added/i.test(dup), "duplicate expense accepted");
      await s.page.click('input[aria-label="Expense amount"]', { clickCount: 3 }); await s.page.keyboard.press("Backspace");
      await s.pickByAria("Expense detail", "Others");
      await s.page.type('input[aria-label="Expense amount"]', "200");
      await s.clickText(".vp-exp-foot button", "Add");
      const noDesc = await err(s); t.note(`Others w/o description: ${noDesc}`);
      t.expect(/Description is required/i.test(noDesc), "Others accepted without description");
      await s.page.type('input[aria-label="Expense description"]', "Late reporting fine");
      await s.clickText(".vp-exp-foot button", "Add");
      const boxes = await s.page.$$('.vp-table input[aria-label="Deduct"]');
      await boxes[boxes.length - 1].click(); await sleep(200);
      const total = await s.page.$eval(".vp-exp-foot input", (i) => i.value);
      const payable = await s.page.$eval(".vp-payable input", (i) => i.value);
      t.note(`Total ${total} ? Total Payable ${payable} (expected 4,050 / 3,850)`);
      t.expect(/4,050\.00/.test(total) && /3,850\.00/.test(payable), "totals wrong");
      await t.shot("totals");
    });
    await tc(s, "DP-05", "Save submits the daily payment to RSOM; it appears in Driver Payments as Pending", "RBP", async (t) => {
      await save(s); await sleep(1200); await s.waitIdle();
      t.note(`toast: ${(await s.toast()).join(" / ")} ? url ${new URL(s.page.url()).pathname}`);
      const r = await api("RBP", "GET", `/settlements?scope=all&q=${encodeURIComponent(TK)}&category=DAILY`);
      const p = r.json.data.items[0];
      t.note(`stored: ${p?.paymentNumber} ${p?.status} ?${p?.amount}`);
      t.expect(p && p.status === "PENDING" && p.amount === 3850, "stored record wrong");
      state.daily1 = p._id; state.daily1No = p.paymentNumber;
      await t.shot("list");
    });
    await tc(s, "DP-06", "An overlapping period for the same vehicle + driver is refused", "RBP", async (t) => {
      await openDaily(s);
      await s.dateByAria("From Date", D1); await s.dateByAria("To Date", D1);
      await s.page.type('input[aria-label="Food"]', "100");
      await save(s); await sleep(600);
      const e = await err(s); t.note(e);
      t.expect(/already covers/i.test(e), "overlap accepted");
      await t.shot("overlap");
    });
    await tc(s, "DP-07", "Rapid double-click on Save creates exactly one payment", "RBP", async (t) => {
      await openDaily(s);
      await s.dateByAria("From Date", D2); await s.dateByAria("To Date", D2);
      await s.page.type('input[aria-label="Food"]', "300");
      const before = (await api("RBP", "GET", `/settlements?scope=all&q=${encodeURIComponent(TK)}&category=DAILY`)).json.data.total;
      await s.page.evaluate(() => { const b = [...document.querySelectorAll(".dsf-actions button")].find((x) => x.textContent.trim() === "Save"); b.click(); b.click(); b.click(); });
      await sleep(2500); await s.waitIdle();
      const after = (await api("RBP", "GET", `/settlements?scope=all&q=${encodeURIComponent(TK)}&category=DAILY`)).json.data.total;
      t.note(`daily payments for the project: ${before} -> ${after}`);
      t.expect(after === before + 1, `expected +1, got +${after - before}`);
    });
    await s.logout(); await s.uiLogin("RSOM");
    const openRow = async (no) => { await s.goto("/rsom/payments"); await s.page.type(".ds-search", no, { delay: 20 }); await sleep(900); await s.waitIdle(); await s.clickText("table tbody tr button", "View"); await sleep(900); await s.waitIdle(); };
    await tc(s, "DP-08", "RSOM: rejection needs a reason; rejects with a reason", "RSOM", async (t) => {
      await openRow(state.daily1No);
      await t.shot("detail");
      await s.clickText(".modal button", "Reject");
      await s.clickText(".modal button", "Confirm Reject");
      const e = await s.text(".modal .ds-inline-form .alert"); t.note(`empty reason: ${e}`);
      t.expect(/reason/i.test(e), "rejection without reason");
      await s.page.type(".modal .ds-inline-form textarea", "QA: toll receipt missing");
      await s.clickText(".modal button", "Confirm Reject");
      await sleep(1200); await s.waitIdle();
      t.expect(/Rejected/i.test(await s.text(".modal")), "not rejected");
      await t.shot("rejected");
      await s.page.keyboard.press("Escape");
    });
    await s.logout(); await s.uiLogin("RBP");
    await tc(s, "DP-09", "RBP: corrects the rejected payment and resubmits it as version 2 (history kept)", "RBP", async (t) => {
      await s.goto("/rbp/payments");
      await s.page.type(".ds-search", state.daily1No, { delay: 20 }); await sleep(900); await s.waitIdle();
      await s.clickText("table tbody tr button", "View"); await sleep(900);
      await s.clickText(".modal a", "Correct & Resubmit"); await sleep(1500); await s.waitIdle();
      const f = await s.page.$('input[aria-label="Food"]');
      await f.click({ clickCount: 3 }); await s.page.keyboard.press("Backspace"); await f.type("450");
      await save(s); await sleep(1500); await s.waitIdle();
      const p = (await api("RBP", "GET", `/settlements/${state.daily1}`)).json.data;
      t.note(`now v${p.version} ${p.status} ?${p.amount}; history: ${p.history.map((h) => `${h.action}:${h.role}`).join(" > ")}`);
      t.expect(p.version === 2 && p.status === "PENDING" && p.amount === 3900, "resubmission wrong");
    });
    await s.logout(); await s.uiLogin("RSOM");
    await tc(s, "DP-10", "RSOM: approves version 2", "RSOM", async (t) => {
      await openRow(state.daily1No);
      await s.clickText(".modal button", "Approve");
      await s.clickText(".modal .ds-inline-form button.btn-primary", "Approve");
      await sleep(1200); await s.waitIdle();
      t.expect(/Approved/.test(await s.text(".modal")), "not approved");
      await t.shot("approved");
    });
    await s.logout(); await s.uiLogin("RSA");
    await tc(s, "DP-11", "RSA sees the approved entry in Settlement Payments and the same record in shared Driver Payments", "RSA", async (t) => {
      await s.goto("/rsa/settlements");
      await s.page.type(".ds-search", state.daily1No, { delay: 20 }); await sleep(900); await s.waitIdle();
      const q = await s.text("table tbody");
      await s.goto("/rsa/driver-payments");
      await s.page.type(".ds-search", state.daily1No, { delay: 20 }); await sleep(900); await s.waitIdle();
      const shared = await s.text("table tbody");
      t.note(`queue row: ${q.replace(/\s+/g, " ").slice(0, 120)}`);
      t.expect(q.includes(state.daily1No) && /Approved/.test(q) && shared.includes(state.daily1No), "RSA does not see the entry");
      await t.shot("rsa-sees");
    });
    fs.writeFileSync("./state.json", JSON.stringify(state, null, 2));
  });
})();
