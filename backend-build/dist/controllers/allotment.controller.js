import { allotVehicle, allotmentDetail, changeVehicle, extendAllotment, listAllotmentProjects, listAllotments, releaseAllotment, searchAvailableVehicles, } from "../services/allotment.service.js";
import { assignDriver, changeDriver, getDriverBank, lookupAvailableDriver, searchAvailableDrivers, updateDriverBank } from "../services/allotmentDriver.service.js";
import { syncClearances } from "../services/clearance.service.js";
import { sendResponse } from "../utils/sendResponse.js";
const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);
const q = (v) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const n = (v) => (typeof v === "string" && /^\d+$/.test(v) ? Number(v) : undefined);
/** Opens / refreshes the RSA clearance of the project vehicle just allotted. It never blocks or fails the allotment call itself. */
const submitClearance = async (a) => {
    try {
        await syncClearances({ trackingVehicle: a?.trackingVehicle });
    }
    catch (e) {
        console.error("Clearance submission failed", e);
    }
};
export const projects = wrap(async (req, res) => {
    const data = await listAllotmentProjects(q(req.query.q) ?? "", n(req.query.page), n(req.query.limit), q(req.query.projectType));
    res.status(200).json(sendResponse(true, "Approved projects fetched successfully", data));
});
export const vehicles = wrap(async (req, res) => {
    const data = await searchAvailableVehicles(q(req.query.q) ?? "", n(req.query.limit));
    res.status(200).json(sendResponse(true, "Available vehicles fetched successfully", data));
});
export const drivers = wrap(async (req, res) => {
    const data = await searchAvailableDrivers(q(req.query.q) ?? "", n(req.query.limit));
    res.status(200).json(sendResponse(true, "Available drivers fetched successfully", data));
});
/** Exact Driver Number or Driver Name lookup for the two-way auto mapping (only an Available Now driver resolves). */
export const driverLookup = wrap(async (req, res) => {
    const data = await lookupAvailableDriver({ number: q(req.query.number), name: q(req.query.name) });
    res.status(200).json(sendResponse(true, "Driver fetched successfully", data));
});
export const driverBank = wrap(async (req, res) => {
    res.status(200).json(sendResponse(true, "Driver bank details fetched successfully", await getDriverBank(String(req.params.driverId))));
});
export const saveDriverBank = wrap(async (req, res) => {
    const data = await updateDriverBank(String(req.params.id), String(req.params.driverId), req.body ?? {}, req.user.username);
    res.status(200).json(sendResponse(true, "Driver bank details updated successfully", data));
});
export const assign = wrap(async (req, res) => {
    const data = await assignDriver(String(req.params.id), req.body ?? {}, req.user.username);
    await submitClearance(data);
    res.status(200).json(sendResponse(true, "Driver assigned successfully", data));
});
export const changeDrv = wrap(async (req, res) => {
    const data = await changeDriver(String(req.params.id), req.body ?? {}, req.user.username);
    await submitClearance(data);
    res.status(200).json(sendResponse(true, "Driver changed successfully", data));
});
export const list = wrap(async (req, res) => {
    const data = await listAllotments({
        q: q(req.query.q), vehicleNo: q(req.query.vehicleNo), clientName: q(req.query.clientName), trackupNumber: q(req.query.trackupNumber),
        pifNumber: q(req.query.pifNumber), projectType: q(req.query.projectType), status: q(req.query.status), from: q(req.query.from), to: q(req.query.to),
        page: n(req.query.page), limit: n(req.query.limit),
    });
    res.status(200).json(sendResponse(true, "Allotments fetched successfully", data));
});
export const one = wrap(async (req, res) => {
    res.status(200).json(sendResponse(true, "Allotment fetched successfully", await allotmentDetail(String(req.params.id))));
});
export const allot = wrap(async (req, res) => {
    const data = await allotVehicle(req.body ?? {}, req.user.username);
    await submitClearance(data);
    res.status(201).json(sendResponse(true, data.driver ? "Vehicle and driver allotted successfully" : "Vehicle allotted successfully", data));
});
export const change = wrap(async (req, res) => {
    const data = await changeVehicle(String(req.params.id), req.body ?? {}, req.user.username);
    await submitClearance(data);
    res.status(200).json(sendResponse(true, "Vehicle changed successfully", data));
});
export const extend = wrap(async (req, res) => {
    res.status(200).json(sendResponse(true, "Allotment updated successfully", await extendAllotment(String(req.params.id), req.body ?? {}, req.user.username)));
});
export const release = wrap(async (req, res) => {
    res.status(200).json(sendResponse(true, "Vehicle released successfully", await releaseAllotment(String(req.params.id), req.body ?? {}, req.user.username)));
});
