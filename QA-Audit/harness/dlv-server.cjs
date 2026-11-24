const fs = require("fs"); const path = require("path");
const { apiLogin } = require("./qa.cjs");
const API = "http://localhost:5100/api";
(async () => {
  const t = await apiLogin("RBP");
  const H = { Authorization: `Bearer ${t}` };
  // a fresh, not-yet-delivered approved clearance is needed for upload: list RBP on-road rows
  const list = await (await fetch(`${API}/on-road-vehicles?limit=100`, { headers: H })).json();
  const items = list.data.items ?? list.data;
  const target = items.find((x) => x.status === "APPROVED" && x.deliveryStatus !== "DELIVERED") ?? items[0];
  console.log("target clearance:", target?.trackupNumber, target?.status, target?.deliveryStatus);
  const up = async (file, type) => {
    const fd = new FormData();
    fd.append("file", new Blob([fs.readFileSync(path.join(__dirname, "fixtures", file))], { type }), file);
    const r = await fetch(`${API}/on-road-vehicles/${target._id}/photos/speedometer`, { method: "POST", headers: H, body: fd });
    return `${r.status} ${(await r.text()).slice(0, 120)}`;
  };
  console.log("server, 11 MB png  ->", await up("too-big.png", "image/png"));
  console.log("server, text as png ->", await up("not-an-image.png", "image/png"));
  const r = await fetch(`${API}/on-road-vehicles/${target._id}/deliver`, { method: "POST", headers: { ...H, "Content-Type": "application/json" }, body: JSON.stringify({ description: "", version: 1 }) });
  console.log("server, empty delivery ->", r.status, (await r.text()).slice(0, 140));
})();
