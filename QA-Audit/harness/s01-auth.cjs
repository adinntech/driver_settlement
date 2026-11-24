const { scenario, tc, CREDS, sleep } = require("./qa.cjs");
const HOME = { RSOP: "/rsop", RBP: "/rbp", RSOM: "/rsom", RSA: "/rsa", RSO: "/rso" };
(async () => {
  await scenario("S01-auth-and-access-control", async (s) => {
    await s.goto("/login");
    await tc(s, "AUTH-01", "Login screen lists all five roles (RSO separate from RSOM)", "ALL", async (t) => {
      const roles = await s.page.$$eval(".role-card strong", (e) => e.map((x) => x.textContent.trim()));
      t.note(`role cards: ${roles.join(", ")}`);
      t.expect(["RSOP Login", "RBP Login", "RSOM Login", "RSA Login", "RSO Login"].every((r) => roles.includes(r)), "a role card is missing");
      await t.shot("login-roles");
    });
    for (const role of Object.keys(HOME)) {
      await tc(s, `AUTH-LOGIN-${role}`, `${role} logs in with valid credentials and lands on its home`, role, async (t) => {
        await s.uiLogin(role);
        t.note(`url after login: ${s.page.url()}`);
        t.expect(s.page.url().includes(HOME[role]), `expected ${HOME[role]}`);
        const nav = await s.page.$$eval(".sidebar nav a", (a) => a.map((x) => x.textContent.trim()));
        t.note(`sidebar: ${nav.join(" | ")}`);
        await t.shot(`${role}-home`);
      });
    }
    await tc(s, "AUTH-02", "Wrong password is rejected with a clear message", "RBP", async (t) => {
      await s.uiLogin("RBP", { username: CREDS.RBP.username, password: "wrong-password-123" });
      const err = await s.text(".login-form .alert");
      t.note(`message: ${err}`);
      t.expect(/invalid credentials/i.test(err), "no invalid-credentials message");
      t.expect(s.page.url().includes("/login"), "should stay on login");
      await t.shot("wrong-password");
    });
    await tc(s, "AUTH-03", "Valid credentials used with the wrong role card are rejected", "RSOM", async (t) => {
      await s.uiLogin("RSOM", CREDS.RBP);
      const err = await s.text(".login-form .alert");
      t.note(`message: ${err}`);
      t.expect(/invalid credentials/i.test(err), "RBP credentials accepted on RSOM card");
    });
    await tc(s, "AUTH-04", "Empty username / password cannot be submitted", "RSA", async (t) => {
      await s.goto("/login");
      await s.page.evaluate(() => { localStorage.clear(); });
      await s.goto("/login");
      await s.clickText(".role-card strong", "RSA Login");
      await s.fillSel(".login-form input[autocomplete=username]", "");
      await s.page.click(".login-form button.btn-primary");
      await sleep(500);
      const valid = await s.page.$eval(".login-form input[autocomplete=username]", (i) => i.validity.valid);
      t.note(`username field valid=${valid}, still on ${s.page.url()}`);
      t.expect(!valid && s.page.url().includes("/login"), "empty submit was not blocked");
      await t.shot("empty-fields");
    });
    await tc(s, "AUTH-05", "A signed-in role cannot open another role's pages (redirected to own home)", "RSOM", async (t) => {
      await s.uiLogin("RSOM");
      for (const p of ["/rbp/payments", "/rsa/settlements", "/rso/reports", "/rsop/new"]) {
        await s.goto(p);
        await sleep(600);
        t.note(`${p} -> ${new URL(s.page.url()).pathname}`);
        t.expect(new URL(s.page.url()).pathname.startsWith("/rsom"), `RSOM reached ${p}`);
      }
    });
    await tc(s, "AUTH-06", "Expired / tampered session token sends the user back to login", "RSA", async (t) => {
      await s.uiLogin("RSA");
      await s.page.evaluate(() => localStorage.setItem("ds_token", "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiUlNBIn0.tampered"));
      await s.goto("/rsa/settlements");
      await sleep(800);
      t.note(`after tampered token: ${new URL(s.page.url()).pathname}`);
      t.expect(s.page.url().includes("/login"), "tampered token not rejected");
      await t.shot("expired-session");
    });
    await tc(s, "AUTH-07", "Refresh keeps the session; logout ends it and protected pages need login again", "RSO", async (t) => {
      await s.uiLogin("RSO");
      await s.page.reload({ waitUntil: "networkidle0" });
      await sleep(500);
      t.expect(s.page.url().includes("/rso"), "refresh lost the session");
      await s.clickText(".side-foot button", "Sign out");
      await sleep(600);
      t.note(`after sign out: ${new URL(s.page.url()).pathname}`);
      await s.goto("/rso/reports");
      await sleep(600);
      t.expect(s.page.url().includes("/login"), "protected page reachable after logout");
      await s.page.goBack({ waitUntil: "networkidle0" });
      await sleep(600);
      t.note(`browser Back after logout: ${new URL(s.page.url()).pathname}`);
      t.expect(!s.page.url().includes("/rso/") || (await s.has("Sign in")), "Back re-opened a protected page");
    });
  });
})();
