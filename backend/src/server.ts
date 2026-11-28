import app from "./app.js";
import { config } from "./config/index.js";
import { connectDB } from "./db/connect.js";
import { seedUsers } from "./services/auth.service.js";
import { User } from "./models/User.js";
import { TrackingVehicle } from "./models/TrackingVehicle.js";
import { TrackingProject } from "./models/TrackingProject.js";
import { Budget, BudgetVersion } from "./models/Budget.js";
import { BudgetEvent, Notification } from "./models/Approval.js";
import { Vehicle, VehicleHistory } from "./models/Vehicle.js";
import { AllotmentEvent, VehicleAllotment } from "./models/VehicleAllotment.js";
import { Driver, DriverHistory } from "./models/Driver.js";
import { DriverAdvance } from "./models/DriverAdvance.js";
import { Counter, RsaPayment } from "./models/RsaPayment.js";
import { DeletedProject } from "./models/DeletedProject.js";
import { HistoricalSuspense } from "./models/HistoricalSuspense.js";
import { startAvailabilityScheduler } from "./jobs/availabilityScheduler.js";
import { startOpsScheduler } from "./jobs/opsScheduler.js";

if (!config.jwtSecret) {
  console.error("JWT_SECRET is not set. Add it to .env");
  process.exit(1);
}

try {
  await connectDB();
  // Make sure unique indexes exist before accepting traffic (duplicate protection).
  await Promise.all([
    User.init(),
    TrackingVehicle.init(),
    TrackingProject.init(),
    Budget.init(),
    BudgetVersion.init(),
    BudgetEvent.init(),
    Notification.init(),
    Vehicle.init(),
    VehicleHistory.init(),
    VehicleAllotment.init(),
    AllotmentEvent.init(),
    Driver.init(),
    DriverHistory.init(),
    DriverAdvance.init(),
    RsaPayment.init(),
    Counter.init(),
    DeletedProject.init(),
    HistoricalSuspense.init(),
  ]);
  await seedUsers();
} catch (err) {
  console.error("Startup failed:", err);
  process.exit(1);
}

app.listen(config.port, () => {
  console.log(`Backend running on port ${config.port} (${config.env})`);
  startAvailabilityScheduler(); // releases vehicles whose next-available time has been reached (IST)
  startOpsScheduler(); // DB backup + health report at 00/06/12/18 IST, health alerts (only when enabled in .env)
});
