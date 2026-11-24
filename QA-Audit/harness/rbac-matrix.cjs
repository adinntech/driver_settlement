const { api } = require("./qa.cjs");
const ROLES = ["RSOP", "RBP", "RSOM", "RSA", "RSO"];
const fake = "aaaaaaaaaaaaaaaaaaaaaaaa";
const EP = [
  ["GET", "/tracking"], ["POST", "/tracking"], ["GET", "/budgets"], ["GET", "/approvals?limit=1"],
  ["GET", "/vehicles?limit=1"], ["GET", "/drivers?limit=1"], ["GET", "/vehicle-allotments/projects?limit=1"],
  ["GET", "/rsa-clearances?limit=1"], ["GET", "/on-road-vehicles?limit=1"], ["GET", "/rsa/payments?limit=1"],
  ["GET", "/settlements?limit=1"], ["GET", "/settlements?scope=all&limit=1"], ["GET", "/settlements/projects?limit=1"],
  ["POST", `/settlements/projects/${fake}/daily`], ["POST", `/settlements/${fake}/approve`], ["POST", `/settlements/${fake}/complete`],
  ["GET", "/settlements/export/approved"], ["GET", "/settlements/reports/driver-list"], ["GET", `/settlements/${fake}/salary-pdf`],
];
(async () => {
  const rows = [];
  for (const [m, p] of EP) {
    const cells = [];
    for (const r of ROLES) { const x = await api(r, m, p, m === "POST" ? {} : undefined); cells.push(x.status); }
    rows.push(`| ${m} ${p.replace(fake, ":id")} | ${cells.join(" | ")} |`);
  }
  const noAuth = await fetch("http://localhost:5100/api/settlements").then((r) => r.status);
  console.log(`| Endpoint | ${ROLES.join(" | ")} |\n|---|${ROLES.map(() => "---").join("|")}|\n${rows.join("\n")}\n\nNo token -> GET /settlements: ${noAuth}`);
})();
