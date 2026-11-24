const fs = require("fs");
const { scenario, tc, sleep, todayIst, addDays } = require("./qa.cjs");
const state = JSON.parse(fs.readFileSync("./state.json", "utf8"));
const trackup = state.roadshow.trackup;
async function openBudget(s) {
  await s.goto("/rbp");
  await s.page.type(".card input, .filters input", trackup.slice(3, 8), { delay: 30 });
  await sleep(900); await s.waitIdle();
  await s.page.click(".project-head");
  await sleep(500);
  await s.clickText(".project-body a.btn", "Budget");
  await sleep(800); await s.waitIdle();
}
(async () => {
  await scenario("S03-budget-lifecycle", async (s) => {
    await s.uiLogin("RBP");
    await tc(s, "BUD-01", "RBP: budget with Completion Date before On Road Date is refused", "RBP", async (t) => {
      await openBudget(s);
      t.note(`budget page: ${new URL(s.page.url()).pathname}${new URL(s.page.url()).search}`);
      await s.fill("Mileage", "8");
      await s.fill("Estimated KM per day", "90");
      await s.date("On Road Date", addDays(todayIst(), 6));
      await s.date("Completion Date", addDays(todayIst(), 2));
      await s.fill("Diesel Cost", "18000");
      await s.fill("Salary", "850");
      await s.fill("Food", "250");
      await s.clickText("button.btn-primary", "Save", { exact: true });
      await sleep(500);
      if (await s.page.$(".modal")) await s.clickText(".modal button", "Save", { exact: true });
      await sleep(700);
      const err = await s.text(".alert");
      t.note(`message: ${err.replace(/\n/g, " | ")}`);
      t.expect(/completion|date/i.test(err), "inconsistent dates accepted");
      await t.shot("dates-invalid");
    });
    await tc(s, "BUD-02", "RBP: valid budget V1 is saved and submitted to RSOM", "RBP", async (t) => {
      await s.date("On Road Date", addDays(todayIst(), 1));
      await s.date("Completion Date", addDays(todayIst(), 12));
      await s.clickText("button.btn-primary", "Save", { exact: true });
      await s.clickText(".modal button", "Save", { exact: true });
      await sleep(1200); await s.waitIdle();
      t.note(`toast: ${(await s.toast()).join(" / ")}`);
      const total = await s.text("body");
      await t.shot("v1-saved");
      await s.clickText("button.btn-primary", "Submit for Approval");
      await s.clickText(".modal button", "Submit", { exact: true });
      await sleep(1200); await s.waitIdle();
      const status = await s.text(".approval-panel");
      t.note(status.slice(0, 120).replace(/\n/g, " | "));
      t.expect(/Pending|submitted/i.test(status), "not pending after submit");
      await t.shot("v1-submitted");
      state.budgetUrl = s.page.url();
    });
    await tc(s, "BUD-03", "RBP cannot approve its own budget (API call from the RBP session is refused)", "RBP", async (t) => {
      const r = await s.page.evaluate(async () => {
        const id = new URL(location.href).searchParams.get("vehicle");
        const tok = localStorage.getItem("ds_token");
        const res = await fetch("http://localhost:5100/api/approvals/" + id + "/approve", { method: "POST", headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" }, body: "{}" });
        return res.status;
      });
      t.note(`POST /approvals/:id/approve as RBP -> HTTP ${r}`);
      t.expect(r === 403 || r === 404, `unexpected ${r}`);
    });
    await s.logout();
    await s.uiLogin("RSOM");
    await tc(s, "BUD-04", "RSOM: rejection without reason / fields is refused", "RSOM", async (t) => {
      await s.page.type(".filters input[aria-label='Trackup number']", trackup, { delay: 20 }).catch(async () => {});
      await sleep(800); await s.waitIdle();
      await s.clickText("table tbody tr a", "Review Budget");
      await sleep(900); await s.waitIdle();
      await s.clickText("button", "Reject Budget");
      await s.clickText(".modal button", "Confirm Rejection");
      const err = await s.text(".modal .alert");
      t.note(err.replace(/\n/g, " | "));
      t.expect(/reason is required/i.test(err) && /at least one field/i.test(err), "empty rejection accepted");
      await t.shot("reject-empty");
    });
    await tc(s, "BUD-05", "RSOM: rejects V1 with a reason and a field-level comment", "RSOM", async (t) => {
      await s.page.type(".modal textarea", "QA: diesel cost is higher than the route needs");
      await s.clickText(".modal .reject-field label", "Diesel");
      await sleep(200);
      const boxes = await s.page.$$(".modal .reject-field textarea");
      await boxes[0].type("Reduce diesel to match 90 km/day");
      await t.shot("reject-filled");
      await s.clickText(".modal button", "Confirm Rejection");
      await sleep(1200); await s.waitIdle();
      t.note(`toast: ${(await s.toast()).join(" / ")}`);
      const page = await s.text("main");
      t.expect(/Rejected V1/i.test(page), "not rejected");
      await t.shot("rejected");
    });
    await s.logout();
    await s.uiLogin("RBP");
    await tc(s, "BUD-06", "RBP: rejection is visible; resubmit is disabled until a new version is saved", "RBP", async (t) => {
      await s.page.goto(state.budgetUrl, { waitUntil: "networkidle0" }); await sleep(600);
      const panel = await s.text(".approval-panel");
      t.note(panel.slice(0, 220).replace(/\n/g, " | "));
      const disabled = await s.page.evaluate(() => [...document.querySelectorAll(".approval-panel button")].find((b) => b.textContent.includes("Resubmit"))?.disabled);
      t.expect(/Rejected by/i.test(panel) && /Diesel/i.test(panel), "rejection details missing");
      t.expect(disabled === true, "resubmit allowed without changes");
      await t.shot("rejection-seen");
    });
    await tc(s, "BUD-07", "RBP: edits the rejected field, saves V2 and resubmits", "RBP", async (t) => {
      await s.clickText("button.btn-primary", "Edit Budget");
      await s.fill("Diesel Cost", "15500");
      await s.clickText("button.btn-primary", "Save New Version");
      await s.clickText(".modal button", "Save", { exact: true });
      await sleep(1200); await s.waitIdle();
      await s.clickText(".approval-panel button", "Resubmit to RSOM");
      await s.clickText(".modal button", "Resubmit", { exact: true });
      await sleep(1200); await s.waitIdle();
      const panel = await s.text(".approval-panel");
      t.note(panel.slice(0, 140).replace(/\n/g, " | "));
      t.expect(/V2/.test(panel) && /Pending|submitted/i.test(panel), "V2 not pending");
      await t.shot("v2-resubmitted");
    });
    await s.logout();
    await s.uiLogin("RSOM");
    await tc(s, "BUD-08", "RSOM: sees V1 vs V2 comparison and approves V2", "RSOM", async (t) => {
      await s.page.type(".filters input[aria-label='Trackup number']", trackup, { delay: 20 }).catch(() => {});
      await sleep(800); await s.waitIdle();
      await s.clickText("table tbody tr a", "Review Budget");
      await sleep(900); await s.waitIdle();
      const cmp = await s.text("main");
      t.expect(/V1 \(rejected\) vs V2/.test(cmp), "no version comparison");
      t.expect(/15,500|15500/.test(cmp), "new diesel value not shown");
      await t.shot("comparison");
      await s.clickText("button", "Approve Budget");
      await s.clickText(".modal button", "Approve", { exact: true });
      await sleep(1200); await s.waitIdle();
      t.expect(/Approved V2/.test(await s.text("main")), "not approved");
      await t.shot("approved");
    });
    fs.writeFileSync("./state.json", JSON.stringify(state, null, 2));
  });
})();
