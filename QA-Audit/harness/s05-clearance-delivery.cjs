const fs = require("fs"); const path = require("path");
const { scenario, tc, sleep } = require("./qa.cjs");
const state = JSON.parse(fs.readFileSync("./state.json", "utf8"));
const TK = state.roadshow.trackup; const FX = path.join(__dirname, "fixtures");
async function findRow(s, base) {
  await s.goto(base);
  await s.page.type('input[aria-label="Mass search"]', TK, { delay: 20 });
  await sleep(900); await s.waitIdle();
}
(async () => {
  await scenario("S05-clearance-and-delivery", async (s) => {
    await s.uiLogin("RSA");
    await tc(s, "CLR-01", "RSA: rejection cannot be confirmed without a reason", "RSA", async (t) => {
      await findRow(s, "/rsa/clearance");
      await s.clickText("table tbody tr a, table tbody tr button", "Review");
      await sleep(900); await s.waitIdle();
      await s.clickText("button", "Reject Vehicle");
      const disabled = await s.page.evaluate(() => [...document.querySelectorAll(".modal button")].find((b) => b.textContent.includes("Confirm Rejection"))?.disabled);
      t.note(`Confirm Rejection disabled with no reason: ${disabled}`);
      t.expect(disabled === true, "rejection possible without reason");
      await t.shot("reject-no-reason");
    });
    await tc(s, "CLR-02", "RSA: rejects the allocation with a reason", "RSA", async (t) => {
      const trig = await s.page.$('.modal .ui-select-trigger[aria-label="Rejection reason"]');
      await trig.click(); await sleep(250);
      const opt = await s.page.$$eval(".ui-select-pop .ui-opt span", (o) => o.map((x) => x.textContent.trim()).filter((x) => x && x !== "Select a reason"));
      t.note(`reasons offered: ${opt.join(" / ")}`);
      const pickReason = opt.find((o) => o !== "Other") ?? opt[0];
      await s.clickText(".ui-select-pop .ui-opt span", pickReason, { exact: true });
      await s.page.type('.modal textarea[aria-label="Additional remarks"]', "QA: licence copy unreadable");
      await s.clickText(".modal button", "Confirm Rejection");
      await sleep(1200); await s.waitIdle();
      t.note(`toast: ${(await s.toast()).join(" / ")}`);
      t.expect(/rejected/i.test(await s.text("main")), "not rejected");
      await t.shot("rejected");
    });
    await tc(s, "CLR-03", "RBP cannot approve a clearance (API call from the RBP session is refused)", "RBP", async (t) => {
      const id = new URL(s.page.url()).searchParams.get("id");
      await s.logout(); await s.uiLogin("RBP");
      const st = await s.page.evaluate(async (id) => (await fetch(`http://localhost:5100/api/rsa-clearances/${id}/approve`, { method: "POST", headers: { Authorization: "Bearer " + localStorage.getItem("ds_token"), "Content-Type": "application/json" }, body: "{}" })).status, id);
      t.note(`RBP POST /rsa-clearances/:id/approve -> ${st}`);
      t.expect(st === 403, `expected 403, got ${st}`);
      state.clearanceId = id;
    });
    await tc(s, "CLR-04", "RBP: sees the rejection and resubmits the allocation", "RBP", async (t) => {
      await findRow(s, "/rbp/on-road");
      await t.shot("rbp-list-rejected");
      await s.clickText("table tbody tr a, table tbody tr button", "View");
      await sleep(900); await s.waitIdle();
      const page = await s.text("main");
      t.expect(/licence copy unreadable/i.test(page), "rejection remarks not visible to RBP");
      await s.clickText("button", "Resubmit for RSA Approval");
      await sleep(400);
      await s.clickText(".modal button.btn-primary", "");
      await sleep(1200); await s.waitIdle();
      t.note(`toast: ${(await s.toast()).join(" / ")}`);
      await t.shot("resubmitted");
    });
    await s.logout(); await s.uiLogin("RSA");
    await tc(s, "CLR-05", "RSA: approves the resubmitted allocation", "RSA", async (t) => {
      await s.goto(`/rsa/clearance/review?id=${state.clearanceId}`);
      await sleep(600);
      await s.clickText("button", "Approve Vehicle");
      await s.clickText(".modal button", "Confirm Approval");
      await sleep(1200); await s.waitIdle();
      const body = await s.text("main");
      t.note(`toast: ${(await s.toast()).join(" / ")}`);
      t.expect(/approved/i.test(body), "not approved");
      await t.shot("approved");
    });
    await s.logout(); await s.uiLogin("RBP");
    const openDeliver = async () => { await findRow(s, "/rbp/on-road"); await s.clickText("table tbody tr a", "Deliver"); await sleep(900); await s.waitIdle(); };
    await tc(s, "DLV-01", "Delivery: confirming without description / photos is refused", "RBP", async (t) => {
      await openDeliver();
      await s.clickText("button", "Confirm Vehicle Delivery");
      await sleep(500);
      const err = await s.text(".alert");
      t.note(err.replace(/\n/g, " | "));
      t.expect(/description/i.test(err) && /photo/i.test(err), "missing description/photos accepted");
      await t.shot("empty");
    });
    await tc(s, "DLV-02", "Delivery: a non-image file is refused", "RBP", async (t) => {
      const inp = await s.page.$('input[aria-label="Speedometer Photo file"]');
      await inp.uploadFile(path.join(FX, "not-an-image.png"));
      await sleep(600);
      await s.clickText("button", "Confirm Vehicle Delivery"); await sleep(500);
      const err = await s.text("main");
      t.note((await s.text(".alert")).replace(/\n/g, " | "));
      await t.shot("not-image");
      t.expect(/(not a valid|unsupported|image|type|format)/i.test(await s.text(".alert")), "fake image not flagged in the form");
    });
    await tc(s, "DLV-03", "Delivery: a photo over 10 MB is refused", "RBP", async (t) => {
      const inp = await s.page.$('input[aria-label="Speedometer Photo file"]');
      await inp.uploadFile(path.join(FX, "too-big.png"));
      await sleep(600);
      await s.clickText("button", "Confirm Vehicle Delivery"); await sleep(500);
      const err = await s.text(".alert");
      t.note(err.replace(/\n/g, " | "));
      t.expect(/too large|10 MB/i.test(err), "oversize photo accepted");
      await t.shot("too-big");
    });
    await tc(s, "DLV-04", "Delivery: valid description + photos completes the delivery; details show both photos", "RBP", async (t) => {
      await s.page.type('textarea[aria-label="Delivery Description"]', "QA: vehicle handed over to driver DR-2609 at T Nagar depot");
      await (await s.page.$('input[aria-label="Speedometer Photo file"]')).uploadFile(path.join(FX, "speedometer.png"));
      await (await s.page.$('input[aria-label="Driver & Vehicle Handover Photo file"]')).uploadFile(path.join(FX, "handover.png"));
      await sleep(600);
      await s.clickText("button", "Confirm Vehicle Delivery"); await sleep(600);
      await t.shot("confirm");
      await s.clickText(".modal button.btn-primary", "");
      await sleep(2500); await s.waitIdle();
      t.note(`toast: ${(await s.toast()).join(" / ")} ? url ${new URL(s.page.url()).pathname}`);
      if (await s.page.$("a[href*='/rbp/on-road/view']")) await s.clickText("a", "View Details");
      await sleep(1200); await s.waitIdle();
      const imgs = await s.page.$$eval("img", (i) => i.filter((x) => x.naturalWidth > 0 && !x.src.includes("adinn-logo")).length);
      t.note(`loaded photos on details page: ${imgs}`);
      t.expect(/delivered/i.test(await s.text("main")) && imgs >= 2, "delivery not completed or photos missing");
      await t.shot("delivered");
    });
    fs.writeFileSync("./state.json", JSON.stringify(state, null, 2));
  });
})();
