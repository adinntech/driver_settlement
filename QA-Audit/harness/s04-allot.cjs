const fs = require("fs");
const { scenario, tc, sleep, todayIst, addDays, api } = require("./qa.cjs");
const state = JSON.parse(fs.readFileSync("./state.json", "utf8"));
const VEH = "TS07FG4417", DRV = "DR-2609";
const QAV = `TN99QA${String(Date.now()).slice(-4)}`;
(async () => {
  await scenario("S04-vehicle-onboarding-and-allotment", async (s) => {
    await s.uiLogin("RBP");
    await tc(s, "VEH-01", "Add vehicle: empty Vehicle No is refused", "RBP", async (t) => {
      await s.goto("/rbp/vehicles/edit");
      await s.clickText("button", "Save as Draft");
      await sleep(500);
      const err = await s.text(".alert");
      t.note(err.replace(/\n/g, " | ").slice(0, 200));
      t.expect(/vehicle (no|number).*required/i.test(err), "empty vehicle number accepted");
      await t.shot("empty-vehicle-no");
    });
    await tc(s, "VEH-02", "Add vehicle: a duplicate Vehicle No is refused", "RBP", async (t) => {
      await s.fill("Vehicle No", VEH);
      await s.clickText("button", "Save as Draft");
      await sleep(600);
      if (await s.page.$(".modal")) await s.clickText(".modal button.btn-primary", "");
      await sleep(900);
      const err = await s.text(".alert");
      t.note(err.replace(/\n/g, " | ").slice(0, 200));
      t.expect(/already|exists|duplicate/i.test(err), "duplicate vehicle number accepted");
      await t.shot("duplicate");
    });
    await tc(s, "VEH-03", "Add vehicle: a new QA vehicle is saved as draft and listed", "RBP", async (t) => {
      await s.fill("Vehicle No", QAV);
      await s.fill("Make", "QA Make");
      await s.fill("Model", "QA Model");
      await s.clickText("button", "Save as Draft");
      await sleep(600);
      if (await s.page.$(".modal")) await s.clickText(".modal button.btn-primary", "");
      await sleep(1200); await s.waitIdle();
      t.note(`toast: ${(await s.toast()).join(" / ")} · url ${new URL(s.page.url()).pathname}`);
      await s.goto("/rbp/vehicles");
      await s.page.type(".filters-vehicle input", QAV, { delay: 20 });
      await sleep(900); await s.waitIdle();
      const row = await s.text("table tbody");
      t.expect(row.includes(QAV), "new vehicle not listed");
      await t.shot("draft-listed");
    });
    await tc(s, "VEH-04", "Delete draft: the QA draft vehicle can be deleted (test clean-up through the UI)", "RBP", async (t) => {
      await s.clickText("table tbody tr button", "Delete");
      await sleep(400);
      await s.clickText(".modal button.btn-primary", "");
      await sleep(1000); await s.waitIdle();
      t.note(`toast: ${(await s.toast()).join(" / ")}`);
      const row = await s.text("main");
      t.expect(!row.includes(QAV) || /No vehicles/i.test(row), "draft still listed");
    });
    await tc(s, "ALLOT-01", "Allot: confirming without a vehicle is refused", "RBP", async (t) => {
      await s.goto("/rbp/vehicles/allotment");
      await s.page.type('input[aria-label="Search approved projects"]', state.roadshow.trackup.slice(3, 8), { delay: 25 });
      await sleep(900); await s.waitIdle();
      await s.clickText("table tbody tr button", "Allot Vehicle");
      await sleep(500);
      await s.clickText(".modal button", "Confirm Vehicle Allotment");
      const err = await s.text(".modal .alert");
      t.note(err.replace(/\n/g, " | "));
      t.expect(/vehicle/i.test(err), "no vehicle error");
      await t.shot("allot-empty");
    });
    await tc(s, "ALLOT-02", "Allot: vehicle + available driver are allotted to the approved project", "RBP", async (t) => {
      await s.page.type('input[placeholder^="Type the vehicle number"]', VEH, { delay: 30 });
      await sleep(900);
      await s.clickText(".proj-results .proj-item", VEH);
      await s.clickText(".allot-mode label", "Driver");
      await sleep(300);
      const drvInput = await s.page.$('.drv-pick input[aria-label*="Number"], .drv-pick input');
      await drvInput.type(DRV, { delay: 30 });
      await sleep(900);
      await s.clickText(".drv-pick .proj-results .proj-item", DRV);
      await s.dateByAria("Next available date", addDays(todayIst(), 14));
      const nt = await s.page.$('input[aria-label="Next available time"]');
      if (nt) { await nt.click(); await s.page.keyboard.type("1800"); }
      await t.shot("allot-form");
      await s.clickText(".modal button", "Confirm Vehicle Allotment");
      await sleep(500);
      const err = await s.page.$(".modal .alert");
      if (err) t.note(`form errors: ${await s.text(".modal .alert")}`);
      await t.shot("allot-summary");
      await s.clickText(".modal button", "Confirm", { exact: true });
      await sleep(1500); await s.waitIdle();
      t.note(`toast: ${(await s.toast()).join(" / ")}`);
      const row = await s.text("table tbody");
      t.expect(row.includes(VEH) && row.includes(DRV), "allotment not shown on the project row");
      state.allot = { vehicleNo: VEH, driver: DRV };
      await t.shot("allotted");
    });
    await tc(s, "ALLOT-03", "The allotted vehicle and driver are no longer offered as Available Now", "RBP", async (t) => {
      const v = await api("RBP", "GET", "/vehicles?availabilityStatus=AVAILABLE&limit=50");
      const d = await api("RBP", "GET", "/drivers?limit=100");
      const vAvail = v.json.data.items.some((x) => x.vehicleNo === VEH);
      const dAvail = d.json.data.items.find((x) => x.driverNumber === DRV)?.availability?.status;
      t.note(`vehicle ${VEH} still available: ${vAvail}; driver ${DRV} availability: ${dAvail}`);
      t.expect(!vAvail && dAvail !== "AVAILABLE", "double assignment possible");
      await s.goto("/rbp/vehicles");
      await s.page.type(".filters-vehicle input", VEH, { delay: 20 });
      await sleep(900); await s.waitIdle();
      await t.shot("vehicle-in-use");
    });
    fs.writeFileSync("./state.json", JSON.stringify(state, null, 2));
  });
})();
