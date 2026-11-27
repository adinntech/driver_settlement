import mongoose from "mongoose";
import app from "../app.js";
import { config } from "../config/index.js";
import { connectDB } from "../db/connect.js";
import { ROLE_KEYS, ROLES } from "../config/roles.js";
import { PROJECTS } from "./devSeed.data.js";
import { mongoHosts } from "./devSeed.js";
import { verifyDevSeed } from "./devSeed.verify.js";
/** `npm run seed:dev:verify`: signs in as RSOP / RBP / RSOM / RSA and checks the 10 seeded projects (read-only). */
let server;
try {
    if (!config.jwtSecret)
        throw new Error("JWT_SECRET is not set. Add it to backend/.env");
    const creds = {};
    const SEED_ROLES = ROLE_KEYS.filter((k) => k !== "RSO");
    for (const role of SEED_ROLES) {
        const s = config.seedUsers.find((x) => x.role === role);
        if (!s?.password)
            throw new Error(`${role}_PASSWORD is not set in backend/.env, so the ${role} login cannot be verified`);
        creds[role] = { username: s.username || ROLES[role].defaultUsername, password: s.password };
    }
    await connectDB();
    console.log(`Verifying "${mongoose.connection.name}" on ${mongoHosts(config.mongoUri)?.join(",") ?? "remote host"} (read-only)\n`);
    server = app.listen(0);
    const base = `http://127.0.0.1:${server.address().port}/api`;
    // the app logs every request (morgan); hide those lines while the checks run so the report stays readable
    const write = process.stdout.write.bind(process.stdout);
    const isRequestLog = (text) => ["GET", "POST", "PUT", "DELETE"].some((m) => text.replace(/^[^A-Z]*/, "").startsWith(`${m} /api`));
    process.stdout.write = ((chunk, ...rest) => isRequestLog(String(chunk)) ? true : write(chunk, ...rest));
    let r;
    try {
        r = await verifyDevSeed(base, creds);
    }
    finally {
        process.stdout.write = write;
    }
    console.log("Project visibility (vehicles each login can see):");
    console.log(`  ${"Project".padEnd(32)}${SEED_ROLES.map((x) => x.padStart(6)).join("")}`);
    for (const p of PROJECTS) {
        const v = r.visibility[p.key];
        console.log(`  ${`${p.key} ${p.clientName}`.padEnd(32)}${SEED_ROLES.map((x) => String(v?.[x] ?? 0).padStart(6)).join("")}`);
    }
    console.log(`\n${r.checks.length - r.failed.length}/${r.checks.length} checks passed`);
    for (const f of r.failed)
        console.log(`  FAIL [${f.scope}] ${f.name}${f.detail ? ` - ${f.detail}` : ""}`);
    if (r.failed.length)
        process.exitCode = 1;
}
catch (e) {
    console.error(`\nVerification failed: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
}
finally {
    server?.close();
    await mongoose.disconnect();
}
