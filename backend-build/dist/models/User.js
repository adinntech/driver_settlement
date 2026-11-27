import mongoose, { Schema } from "mongoose";
import { ROLE_KEYS } from "../config/roles.js";
const userSchema = new Schema({
    username: { type: String, required: true, unique: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, required: true, enum: ROLE_KEYS },
}, { timestamps: true });
export const User = mongoose.models.User ?? mongoose.model("User", userSchema);
