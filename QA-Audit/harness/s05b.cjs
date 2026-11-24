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
  await scenario("S05b-driver-change-clearance-delivery", async (s) => {
    await s.uiLogin("RBP");
    await tc(s, "ALLOT-04", "Change Driver: missing reason is refused; replacement with ₹750 travel deduction is recorded", "RBP", async (t) => {
      await s.goto("/rbp/vehicles/allotment");
      await s.page.type('input[aria-label="Search approved projects"]', TK.slice(3, 8), { delay: 25 });
      await sleep(900); await s.waitIdle();
      await s.clickText("table tbody tr button", "Change Driver");
      await sleep(500);
      const drv = await s.page.$(".modal .drv-pick input");
      await drv.type("DR-6500", { delay: 30 }); await sleep(900);
      await s.clickText(".modal .proj-results .proj-item", "DR-6500");
      await s.page.type('.modal input[aria-label="Travel Amount Deduction"]', "750");
      await s.clickText(".modal button.btn-primary", "Change Driver");
      await sleep(400);
      const err = await s.text(".modal .alert");
      t.note(`without reason: ${err.replace(/\n/g, " | ")}`);
      t.expect(/reason/i.test(err), "change accepted without reason");
      await s.page.type('.modal textarea[aria-label="Change Reason"]', "QA: original driver blocked by advance verification");
      await s.clickText(".modal button.btn-primary", "Change Driver");
      await sleep(500);
      await t.shot("confirm-change");
      await s.clickText(".modal button", "Confirm Change");
      await sleep(1500); await s.waitIdle();
      t.note(`toast: ${(await s.toast()).join(" / ")}`);
      t.expect((await s.text("table tbody")).includes("DR-6500"), "replacement driver not shown");
      await t.shot("changed");
    });
    await s.logout(); await s.uiLogin("RSA");
    await tc(s, "CLR-05", "RSA: approves the allocation after the driver change (driver without advances)", "RSA", async (t) => {
      await findRow(s, "/rsa/clearance");
      await t.shot("rsa-list");
      await s.clickText("table tbody tr a, table tbody tr button", "Review");
      await sleep(900); await s.waitIdle();
      const blocked = await s.text(".cl-actions");
      t.note(`actions: ${blocked.replace(/\n/g, " | ").slice(0, 160)}`);
      await s.clickText("button", "Approve Vehicle");
      await s.clickText(".modal button", "Confirm Approval");
      await sleep(1200); await s.waitIdle();
      t.note(`toast: ${(await s.toast()).join(" / ")}`);
      t.expect(/approved/i.test(await s.text("main")), "not approved");
      await t.shot("approved");
    });    await s.logout(); await s.uiLogin("RBP");
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
