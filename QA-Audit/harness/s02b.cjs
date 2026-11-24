const fs = require("fs");
const { scenario, tc, sleep } = require("./qa.cjs");
const state = JSON.parse(fs.readFileSync("./state.json", "utf8"));
(async () => {
  await scenario("S02b-rsop-detail-view", async (s) => {
    await s.uiLogin("RSOP");
    await s.goto("/rsop");
    await tc(s, "RSOP-07", "Project detail view opens with every captured field", "RSOP", async (t) => {
      await s.page.type(".filters input", state.signage.jobSheet.slice(2), { delay: 30 });
      await sleep(900); await s.waitIdle();
      await s.clickText("table tbody tr button", "View");
      await sleep(600);
      const m = await s.text(".modal");
      t.note(m.slice(0, 200).replace(/\n/g, " | "));
      t.expect(m.includes(state.signage.jobSheet) && m.includes("Coimbatore"), "captured fields missing in detail");
      await t.shot("detail");
    });
  });
})();
