import mongoose from "mongoose";
import { config } from "../config/index.js";
import { TrackupGroup } from "../models/TrackupGroup.js";
import { migrateIndexes } from "./migrations.js";
import { renameVehicleTypes } from "./vehicleTypeNames.js";
export async function connectDB() {
    await migrateIndexes(config.mongoUri);
    await mongoose.connect(config.mongoUri);
    console.log(`MongoDB connected: ${mongoose.connection.name}`);
    await TrackupGroup.init(); // its unique index guards the shared Trackup Numbers
    await renameVehicleTypes();
}
