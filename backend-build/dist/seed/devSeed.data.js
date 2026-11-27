/**
 * Development mock data: 10 interconnected projects, with the vehicles and drivers they use.
 *
 * Everything here is plain input for the EXISTING services (tracking, budget, approval, vehicle, driver, allotment, clearance,
 * delivery, advance, RSA payment). Nothing in this file writes to the database or bypasses a validation.
 *
 * All names, numbers and identifiers are fictional (client names are well-known brands, as the app's own form placeholders are).
 * Campaign dates are relative to the day the seed first runs, so the data always looks current.
 * Every record carries a stable key (request id / vehicle number / mobile number / idempotency key) so re-running is a no-op.
 */
import { addDays, todayYmd } from "../validators/vehicle.validator.js";
export const SEED_TAG = "dev-seed:v1";
const today = todayYmd();
const d = (n) => addDays(today, n);
/** Stable 8-digit demo Project Code per client and project type (FNV-1a hash), so a client's requests group together. */
export const seedProjectCode = (key) => {
    let h = 0x811c9dc5;
    for (const ch of key)
        h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0;
    return String(10_000_000 + (h % 90_000_000));
};
const drv = (key, name, type, mobile, licence, licenceExpiry, salary, address, bankName, ifsc, acct, extra = {}) => ({
    key, name, type, mobile, licence, licenceType: "LMV + Transport", licenceExpiry, salary, address,
    bank: { accountName: name, bankName, accountNumber: acct, ifsc }, ...extra,
});
export const DRIVERS = [
    drv("D01", "Ganesh Shinde", "COMPANY_DRIVER", "9822140371", "MH1420130045671", "2030-03-14", 850, "Plot 14, Bhosari MIDC Road, Pune, Maharashtra 411039", "State Bank of India", "SBIN0003214", "31982746501"),
    drv("D02", "Dilip Pawar", "ACTING_DRIVER", "9890226154", "MH1220120098312", "2027-01-15", 800, "Ward 6, Shirur Road, Ahilyanagar, Maharashtra 414001", "HDFC Bank", "HDFC0001487", "50100287461923"),
    drv("D03", "Murugan Selvam", "COMPANY_DRIVER", "9840317725", "TN0720110066241", "2029-08-22", 900, "12, Periyar Nagar 2nd Street, Perambur, Chennai 600011", "Indian Overseas Bank", "IOBA0000114", "114201000067321"),
    drv("D04", "Basavaraj Hiremath", "ACTING_DRIVER", "9886502913", "KA0520140037729", "2028-11-05", 850, "No. 48, Kengeri Satellite Town, Bengaluru, Karnataka 560060", "Canara Bank", "CNRB0001245", "1245101008836", { advances: [12, 8] }),
    drv("D05", "Kishore Thakkar", "COMPANY_DRIVER", "9825671048", "GJ0120100153346", "2029-02-18", 950, "B-27, Naroda GIDC Housing, Ahmedabad, Gujarat 382330", "Axis Bank", "UTIB0000212", "917010046288115", { advances: [10] }),
    drv("D06", "Jagdish Rathod", "ACTING_DRIVER", "9879034426", "GJ0620130082215", "2030-06-30", 900, "Plot 9, Makarpura Road, Vadodara, Gujarat 390010", "Bank of Baroda", "BARB0VADODA", "24310100018830"),
    drv("D07", "Venkat Reddy Gudi", "COMPANY_DRIVER", "9704418356", "TS0820120064480", "2029-12-09", 880, "H.No 6-3-112, Uppal Kalan, Hyderabad, Telangana 500039", "ICICI Bank", "ICIC0002345", "234501507768"),
    drv("D08", "Ravindra Kulkarni", "COMPANY_DRIVER", "9448129067", "KA0120110027316", "2031-04-27", 870, "27, 3rd Cross, Vijayanagar, Mysuru, Karnataka 570017", "Karnataka Bank", "KARB0000123", "1237500100225801"),
    drv("D09", "Sanjib Mondal", "ACTING_DRIVER", "9830475629", "WB0620100093341", "2028-09-12", 780, "45/2, Dum Dum Park, Kolkata, West Bengal 700055", "United Bank of India", "UBIN0532266", "0532010100421176"),
    drv("D10", "Pradeep Kumar Mishra", "COMPANY_DRIVER", "9415287630", "UP3220110071938", "2030-10-03", 875, "Sector H, LDA Colony, Kanpur Road, Lucknow, Uttar Pradesh 226012", "Punjab National Bank", "PUNB0123400", "1234000100562287"),
    drv("D11", "Rakesh Chauhan", "COMPANY_DRIVER", "9810456372", "DL0420090125467", "2029-05-21", 1000, "C-118, Sangam Vihar, New Delhi 110062", "Kotak Mahindra Bank", "KKBK0000651", "0511235674"),
    drv("D12", "Anil Kumar Nair", "ACTING_DRIVER", "9447815209", "KL0720120059084", "2028-07-17", 825, "TC 14/822, Vattiyoorkavu, Thiruvananthapuram, Kerala 695013", "Federal Bank", "FDRL0001234", "12340100088754", { advances: [15, 7] }),
    // available, not yet on any project
    drv("D13", "Sathish Kumar R", "COMPANY_DRIVER", "9791234658", "TN0920150034518", "2031-01-25", 800, "7/3, Anna Salai Extension, Tiruchirappalli, Tamil Nadu 620001", "Indian Bank", "IDIB000T012", "6712345098", { advances: [20] }),
    drv("D14", "Mohd. Arif Khan", "ACTING_DRIVER", "9703346281", "TS0920140087126", "2029-03-11", 780, "Flat 203, Tolichowki Main Road, Hyderabad, Telangana 500008", "Yes Bank", "YESB0000011", "000112345678901"),
    drv("D15", "Prakash Bhandari", "COMPANY_DRIVER", "9830478215", "WB0620100093355", "2030-08-08", 880, "18, Salt Lake Sector III, Kolkata, West Bengal 700106", "Bank of India", "BKID0004512", "451210110004982"),
    // on leave and resigned
    drv("D16", "Vikram Singh Rathore", "COMPANY_DRIVER", "9928156043", "RJ1420110045082", "2029-09-30", 920, "Kishanpole Bazar, Jaipur, Rajasthan 302003", "State Bank of India", "SBIN0010412", "62018453211", { state: "NOT_AVAILABLE" }),
    drv("D17", "Santosh Gaikwad", "ACTING_DRIVER", "9561204837", "MH1420180076653", "2028-04-02", 760, "Kalewadi Phata, Pimpri-Chinchwad, Maharashtra 411017", "Bank of Maharashtra", "MAHB0001234", "60312459871", { state: "INACTIVE" }),
];
const veh = (key, vehicleNo, make, model, type, year, purchaseDate, run, spec, extra = {}) => ({
    key, vehicleNo, make, model, type, year, purchaseDate, currentRunning: run[0], totalRunning: run[1], stepney: "Good", battery: "Good",
    fcDays: 240, insuranceDays: 190, permitDays: 300, specification: spec, ...extra,
});
export const VEHICLES = [
    veh("V01", "MH12PQ4521", "Tata", "407 Gold", "Dynamic", 2023, "2023-06-12", [18450, 74210], "LED van, 2 sided 10ft screen, 5 kVA genset"),
    veh("V02", "MH12QR7743", "Eicher", "Pro 2049", "Dynamic", 2022, "2022-09-03", [26300, 112940], "LED van with PA system and promoter seating"),
    veh("V03", "TN07BX2210", "Force", "Traveller 3350", "Dynamic", 2021, "2021-11-20", [31200, 148600], "Backlit panels on both sides, PA system", { fcDays: 95 }),
    veh("V04", "KA05MN9087", "Mahindra", "Bolero Maxitruck Plus", "Utility", 2022, "2022-03-15", [22800, 96350], "Signage installation vehicle with ladder rack", { battery: "Weak", insuranceDays: 70 }),
    veh("V05", "KA51AB3376", "Tata", "Intra V30", "Utility", 2024, "2024-02-09", [9600, 28400], "Signage installation vehicle, open deck 7ft"),
    veh("V06", "GJ01KT6619", "Ashok Leyland", "Dost+", "Dynamic", 2023, "2023-08-25", [17900, 68100], "LED van, 2 sided screen, 5 kVA genset"),
    veh("V07", "TS09EF1204", "Tata", "Ace Gold Petrol", "Utility", 2024, "2024-05-30", [7100, 19850], "Signage vehicle with ladder and tool kit"),
    veh("V08", "KA09HJ6652", "Mahindra", "Bolero Pickup", "Dynamic", 2023, "2023-10-04", [20250, 71300], "Backlit van, PA system"),
    veh("V09", "WB06XY1182", "Tata", "Ace Gold", "Utility", 2023, "2023-07-18", [14850, 52670], "Signage installation vehicle"),
    veh("V10", "WB26CK3345", "Mahindra", "Jeeto Plus", "Utility", 2024, "2024-01-22", [8400, 23900], "Compact signage vehicle", { stepney: "Needs replacement" }),
    veh("V11", "UP32LM5504", "Eicher", "Pro 3015", "Dynamic", 2022, "2022-12-01", [27700, 121480], "LED van with 3 sided screen"),
    veh("V12", "HR26LA8890", "Tata", "407 Ladder Truck", "Ladder Vehicle", 2021, "2021-09-14", [35400, 163220], "Hydraulic ladder for high-rise signage", { fcDays: 130 }),
    veh("V13", "KL07CK3345", "Mahindra", "Bolero Pickup", "Dynamic", 2023, "2023-04-11", [19600, 77450], "Backlit van with PA system"),
    // not on any project yet
    veh("V14", "TS07FG4417", "Tata", "Ace Gold Petrol", "Utility", 2024, "2024-08-16", [5200, 14350], "Spare signage vehicle"),
    veh("V15", "HR55DK7731", "Force", "Traveller 3350", "Event", 2022, "2022-05-06", [24100, 99870], "Event van with PA system", { insuranceDays: 18 }),
    veh("V16", "RJ14GB4458", "Isuzu", "D-Max V-Cross", "Event", 2021, "2021-07-29", [30500, 138900], "Event vehicle", { state: "ISSUE", fcDays: -12 }),
    veh("V17", "PB10CX6002", "Tata", "407 Gold", "Static", 2020, "2020-10-19", [0, 0], "Draft entry: documents pending", { state: "DRAFT" }),
];
export const ISSUE_FOR_V16 = {
    category: "Engine Problem", description: "Engine overheating and coolant leak; vehicle towed to garage", garage: "Sri Balaji Auto Works, Jaipur",
    repairRemarks: "Radiator and water pump replacement in progress", expectedRepairInDays: 6,
};
/** V04 develops a clutch failure on Reliance Retail's project and is replaced by V05; afterwards it is reported as an issue. */
export const ISSUE_FOR_V04 = {
    category: "Mechanical Problem", description: "Clutch plate failure; vehicle sent for repair after replacement on project", garage: "Sri Venkateshwara Motors, Peenya, Bengaluru",
    repairRemarks: "Clutch plate and pressure plate replacement", expectedRepairInDays: 4,
};
const roadshow = (r) => {
    // Elements & Billing dates must lie within the campaign: clamp each one (clamping keeps the production order).
    const inCampaign = (offset) => d(Math.min(r.end, Math.max(r.start, offset)));
    return {
        projectCode: seedProjectCode(`R:${r.client}`), billingName: r.client, stateCode: r.state, numberOfVans: r.vans, vehicleTypes: [{ code: "L_BOX_ROOF", quantity: r.vans }], innovationModel: r.innovation, sundayHalt: r.halt,
        startDate: d(r.start), endDate: d(r.end), reportingDate: d(r.reporting), reportingLocations: r.locations, reportingPerson: r.person,
        contactNumber: r.contact, email: r.email, address: r.address, kmAllotted: r.km, extraKmAllowed: "NO", timing: r.timing,
        paSystem: "YES", mike: "YES", tv: "NO", promoter: "YES", leaflet: "YES", otherElements: "As per approved creative, all required elements",
        artsFileDate: inCampaign(r.reporting - 20), printingDate: inCampaign(r.reporting - 14), fabricationDate: inCampaign(r.reporting - 9), vehicleDeliveryDate: inCampaign(r.reporting - 2),
        supportingDate: inCampaign(r.reporting - 6), invoiceDate: inCampaign(r.end + 5), ...r.extra,
    };
};
const signage = (s) => ({
    projectCode: seedProjectCode(`S:${s.client}`), date: d(s.from - 6), client: s.client, jobSheetNumber: s.job, location: s.location, numberOfVehicles: s.vehicles, vehicleTypes: [{ code: "CENTRE_NO_ROOF", quantity: s.vehicles }], arrivedBudget: s.budget,
    fromDate: d(s.from), toDate: d(s.to), briefWorkDetails: s.work, siteDetails: s.site,
});
const b = (p) => p;
const approvedBudget = (p, submitComment) => ({ v1: p, end: "APPROVED", submitComment });
export const PROJECTS = [
    {
        key: "P01", type: "ROADSHOW", clientName: "Tata Motors Ltd",
        details: roadshow({
            client: "Tata Motors Ltd", state: "27", vans: 2, start: -3, end: 21, reporting: -3, halt: "YES",
            locations: ["Pune – Pimpri Chinchwad", "Nashik", "Kolhapur"], person: "Amit Deshmukh", contact: "98220 55102", email: "amit.deshmukh@example.com",
            address: "Plot 18, Chinchwad Industrial Area, Pune 411019", km: "90 KM per day", innovation: "2 Sided LED Van", timing: "9 Hours", extra: { extraKmAllowed: "YES", extraKmAllotted: 20 },
        }),
        vehicles: [
            {
                budget: approvedBudget(b({ mileage: 9, kmPerDay: 90, salaryPerDay: 850, foodPerDay: 300, haltFood: 1200, from: "Pune", to: "Kolhapur", upDownValue: 3500, tolls: [["Khalapur Toll Plaza (Mumbai–Pune Expressway)", 405], ["Talegaon Toll Plaza", 140], ["Kini Toll Plaza (Pune–Kolhapur)", 125]] }), "Standard 2-van Maharashtra circuit."),
                allot: { vehicle: "V01", driver: "D01", remarks: "Van 1 for Maharashtra roadshow circuit", release: undefined },
                clearance: { outcome: "APPROVE", deliver: "Van handed over to driver at Pimpri depot with full fuel tank; speedometer reading recorded and branding checked." },
                payments: [
                    { key: "p01v1-pay1", diesel: [{ amount: 6000, mode: "ePayment", reference: "HPCL-TXN-480213" }], food: 1800, expenses: [{ optionKey: "TOLL", description: "Pune–Mumbai Expressway tolls", amount: 1240 }] },
                    { key: "p01v1-pay2", diesel: [{ amount: 4500, mode: "Fuel Card", reference: "IOCL-FC-77312" }], food: 1800, expenses: [{ optionKey: "PERMIT", description: "Nashik RTO entry permit", amount: 600 }, { optionKey: "OTHERS", description: "Advance recovered for tyre repair", amount: 450, deduct: true }] },
                ],
            },
            {
                budget: {
                    v1: b({ mileage: 9, kmPerDay: 110, salaryPerDay: 800, foodPerDay: 300, haltFood: 1200, from: "Pune", to: "Nashik", upDownValue: 3000, tolls: [["Talegaon Toll Plaza", 140]] }),
                    rejectV1: { reason: "Toll charges for the Nashik leg are missing and the daily distance looks high for the allotted 90 KM per day.", fields: [{ field: "estimatedKmPerDay", comment: "Client has allotted 90 KM per day; please correct." }, { field: "tolls", comment: "Add Chandori and Pimpalgaon toll plazas for the Nashik leg." }] },
                    v2: { kmPerDay: 90, tolls: [["Talegaon Toll Plaza", 140], ["Chandori Toll Plaza (Nashik)", 95], ["Pimpalgaon Toll Plaza", 110]] },
                    end: "APPROVED", resubmitComment: "Corrected daily distance to 90 KM and added the Nashik toll plazas.",
                },
                allot: { vehicle: "V02", assignLaterDriver: "D02", remarks: "Van 2: vehicle allotted first, driver confirmed after licence check" },
                clearance: { outcome: "APPROVE" },
                payments: [{ key: "p01v2-pay1", cashInHand: true, food: 1500, expenses: [{ optionKey: "FOOD_ALLOWANCE", description: "Driver food allowance - 3 days", amount: 900 }] }],
            },
        ],
    },
    {
        key: "P02", type: "ROADSHOW", clientName: "Hindustan Unilever Ltd",
        details: roadshow({
            client: "Hindustan Unilever Ltd", state: "33", vans: 1, start: -1, end: 14, reporting: -1, halt: "NO",
            locations: ["Chennai – Tambaram", "Vellore", "Tiruvannamalai"], person: "Karthik Subramanian", contact: "98403 22471", email: "karthik.s@example.com",
            address: "Door 22, Guindy Industrial Estate, Chennai 600032", km: "80 KM per day", innovation: "Surf Excel Sampling Van", timing: "8 Hours", extra: {},
        }),
        vehicles: [
            {
                budget: approvedBudget(b({ mileage: 10, kmPerDay: 80, salaryPerDay: 900, foodPerDay: 300, haltFood: 0, from: "Chennai", to: "Tiruvannamalai", upDownValue: 2500, tolls: [["Sriperumbudur Toll Plaza", 115], ["Paranur Toll Plaza", 90]], others: [["Sampling material handling", 1500]] })),
                allot: { vehicle: "V03", driver: "D03", extendByDays: 1, remarks: "Backlit van for HUL sampling roadshow" },
                clearance: { outcome: "PENDING" },
                payments: [{ key: "p02v1-pay1", diesel: [{ amount: 5200, mode: "ePayment", reference: "BPCL-TXN-33901" }], food: 1600, salaryAdvance: 4000 }],
            },
        ],
    },
    {
        key: "P03", type: "SIGNAGE", clientName: "Reliance Retail Ltd",
        details: signage({ client: "Reliance Retail Ltd", job: "26110412", location: "Bengaluru – Whitefield, Indiranagar, Koramangala", vehicles: 1, budget: 85000, from: 0, to: 9, work: "Fascia and in-shop signage installation at 6 stores", site: "Store IDs BLR-0114, 0121, 0127, 0133, 0140, 0152" }),
        vehicles: [
            {
                budget: approvedBudget(b({ mileage: 11, kmPerDay: 45, salaryPerDay: 850, foodPerDay: 250, haltFood: 0, from: "Peenya", to: "Whitefield", upDownValue: 1200, tolls: [["Hoskote Toll Plaza", 60]], others: [["Installation consumables", 2200]] })),
                allot: {
                    vehicle: "V04", assignLaterDriver: "D04", remarks: "Signage installation vehicle with ladder rack",
                    changeVehicleTo: { vehicle: "V05", reason: "Clutch plate failure on the original vehicle", remarks: "Replacement dispatched from Peenya depot the same afternoon" },
                },
                clearance: { outcome: "REJECT", reason: "Outstanding Driver Advance", remarks: "Driver has an open advance on record that is not yet recovered; assign another driver or settle it first." },
                payments: [{ key: "p03v1-pay1", diesel: [{ amount: 3000, mode: "Cash" }], food: 1200, expenses: [{ optionKey: "SERVICE", description: "Mid-route service and oil top-up", amount: 2350 }, { optionKey: "TRAVEL", description: "Driver travel to replacement vehicle pickup", amount: 800 }] }],
            },
        ],
    },
    {
        key: "P04", type: "ROADSHOW", clientName: "Asian Paints Ltd",
        details: roadshow({
            client: "Asian Paints Ltd", state: "24", vans: 2, start: 1, end: 25, reporting: 1, halt: "YES",
            locations: ["Ahmedabad – Naroda", "Vadodara", "Surat"], person: "Hardik Mehta", contact: "98250 61930", email: "hardik.mehta@example.com",
            address: "Survey 112, Naroda GIDC, Ahmedabad 382330", km: "100 KM per day", innovation: "Colour Studio on Wheels", timing: "9 Hours", extra: {},
        }),
        vehicles: [
            {
                budget: approvedBudget(b({ mileage: 8.5, kmPerDay: 100, salaryPerDay: 950, foodPerDay: 320, haltFood: 1500, from: "Ahmedabad", to: "Surat", upDownValue: 4000, tolls: [["Vadodara–Ahmedabad Expressway Toll", 150], ["Bharuch Toll Plaza", 120]] })),
                allot: {
                    vehicle: "V06", driver: "D05", remarks: "Colour Studio van for Gujarat circuit",
                    changeDriverTo: { driver: "D06", reason: "Original driver unavailable at short notice", remarks: "Replacement driver from Vadodara pool", travelDeduction: 750 },
                },
                clearance: { outcome: "APPROVE", deliver: "Van and driver handed over at Naroda GIDC yard; speedometer photo and handover photo captured." },
                payments: [
                    { key: "p04v1-pay1", diesel: [{ amount: 7500, mode: "ePayment", reference: "IOCL-TXN-91027" }], food: 2000 },
                    { key: "p04v1-pay2", diesel: [{ amount: 5000, mode: "ePayment", reference: "IOCL-TXN-91388" }, { amount: 2000, mode: "Cash" }], expenses: [{ optionKey: "TOLL", description: "Ahmedabad–Vadodara toll", amount: 410 }, { optionKey: "FLEET_BALANCE", description: "Fleet balance adjustment", amount: 1000, deduct: true }] },
                ],
            },
            { budget: { v1: b({ mileage: 8.5, kmPerDay: 100, salaryPerDay: 900, foodPerDay: 320, haltFood: 1500, from: "Ahmedabad", to: "Rajkot", upDownValue: 4500, tolls: [["Bagodara Toll Plaza", 135], ["Rajkot–Ahmedabad Toll", 160]] }), end: "PENDING", submitComment: "Second van, Saurashtra leg. Please review." } },
        ],
    },
    {
        key: "P05", type: "SIGNAGE", clientName: "Samsung India Electronics",
        details: signage({ client: "Samsung India Electronics", job: "26110588", location: "Hyderabad – Banjara Hills, Kukatpally, Secunderabad", vehicles: 2, budget: 60000, from: 3, to: 12, work: "Samsung Smart Plaza signage refresh", site: "Plaza IDs HYD-018, 022, 031" }),
        vehicles: [
            {
                budget: approvedBudget(b({ mileage: 11, kmPerDay: 40, salaryPerDay: 880, foodPerDay: 250, haltFood: 0, from: "Uppal", to: "Kukatpally", upDownValue: 900, tolls: [["Shamshabad ORR Toll", 70]] })),
                allot: { vehicle: "V07", driver: "D07", remarks: "Signage installation team vehicle" },
                clearance: { outcome: "APPROVE" },
                payments: [{ key: "p05v1-pay1", diesel: [{ amount: 2200, mode: "ePayment", reference: "HPCL-TXN-60417" }], food: 1000, expenses: [{ optionKey: "FUEL", description: "Fuel top-up for night installation", amount: 600 }] }],
            },
            {
                budget: {
                    v1: b({ mileage: 11, kmPerDay: 70, salaryPerDay: 880, foodPerDay: 250, haltFood: 0, from: "Uppal", to: "Secunderabad", upDownValue: 900, tolls: [] }),
                    rejectV1: { reason: "Diesel estimate is too high for a 3-plaza route and the salary must be per campaign day as per policy.", fields: [{ field: "dieselAmount", comment: "Recalculate for the actual Secunderabad route." }, { field: "salaryUnit", comment: "Salary should be PER_DAY for this campaign." }] },
                    end: "REJECTED", submitComment: "Second vehicle, Secunderabad plazas.",
                },
            },
        ],
    },
    {
        key: "P06", type: "ROADSHOW", clientName: "Mahindra & Mahindra Ltd",
        details: roadshow({
            client: "Mahindra & Mahindra Ltd", state: "29", vans: 3, start: 6, end: 30, reporting: 6, halt: "YES",
            locations: ["Bengaluru – Yelahanka", "Mysuru", "Mangaluru"], person: "Naveen Gowda", contact: "98450 77320", email: "naveen.gowda@example.com",
            address: "No. 7, Yelahanka Industrial Area, Bengaluru 560064", km: "95 KM per day", innovation: "Thar Roxx Experience Van", timing: "9 Hours", extra: {},
        }),
        vehicles: [
            {
                budget: approvedBudget(b({ mileage: 10, kmPerDay: 95, salaryPerDay: 870, foodPerDay: 300, haltFood: 1200, from: "Bengaluru", to: "Mangaluru", upDownValue: 4200, tolls: [["Nelamangala Toll Plaza", 130], ["Bengaluru–Mysuru Expressway Toll", 330]] })),
                allot: { vehicle: "V08", driver: "D08", remarks: "Experience van for Karnataka circuit" },
                clearance: { outcome: "PENDING" },
            },
            {
                budget: {
                    v1: b({ mileage: 10, kmPerDay: 95, salaryPerDay: 870, foodPerDay: 300, haltFood: 0, from: "Bengaluru", to: "Mysuru", upDownValue: 3600, tolls: [["Nelamangala Toll Plaza", 130]] }),
                    rejectV1: { reason: "Expressway toll charges are missing and halt food was not budgeted for the Sunday halts.", fields: [{ field: "tolls", comment: "Add the Bengaluru–Mysuru Expressway toll." }, { field: "haltFood", comment: "Budget halt food for Sunday halts." }] },
                    v2: { haltFood: 1200, tolls: [["Nelamangala Toll Plaza", 130], ["Bengaluru–Mysuru Expressway Toll", 330]] },
                    end: "PENDING", resubmitComment: "Added the expressway toll and halt food as requested.",
                },
            },
            { budget: { v1: b({ mileage: 10, kmPerDay: 95, salaryPerDay: 870, foodPerDay: 300, haltFood: 1200, from: "Bengaluru", to: "Hubballi", upDownValue: 5200, tolls: [["Tumakuru Toll Plaza", 140]] }), end: "DRAFT" } },
        ],
    },
    {
        key: "P07", type: "SIGNAGE", clientName: "Britannia Industries Ltd",
        details: signage({ client: "Britannia Industries Ltd", job: "26110631", location: "Kolkata – Salt Lake, Park Street, Howrah", vehicles: 2, budget: 45000, from: -2, to: 6, work: "Distributor shop-board replacement", site: "Distributor codes KOL-D11, D18, D24" }),
        vehicles: [
            {
                budget: approvedBudget(b({ mileage: 12, kmPerDay: 38, salaryPerDay: 780, foodPerDay: 220, haltFood: 0, from: "Salt Lake", to: "Howrah", upDownValue: 800, tolls: [["Dankuni Toll Plaza", 110]] })),
                allot: { vehicle: "V09", remarks: "Vehicle allotted; driver to be assigned once the crew roster is final" },
            },
            {
                budget: approvedBudget(b({ mileage: 12, kmPerDay: 42, salaryPerDay: 780, foodPerDay: 220, haltFood: 0, from: "Salt Lake", to: "Park Street", upDownValue: 700, tolls: [] })),
                allot: { vehicle: "V10", driver: "D09", remarks: "Second signage vehicle for Kolkata distributors" },
                clearance: { outcome: "REJECT", reason: "Invalid Driver Details", remarks: "Driver licence expiry on the allotment does not match the uploaded document; please verify and resubmit." },
            },
        ],
    },
    {
        key: "P08", type: "ROADSHOW", clientName: "Bajaj Auto Ltd",
        details: roadshow({
            client: "Bajaj Auto Ltd", state: "09", vans: 2, start: 0, end: 18, reporting: 0, halt: "YES",
            locations: ["Lucknow – Aminabad", "Kanpur", "Agra"], person: "Rohit Srivastava", contact: "94150 33218", email: "rohit.srivastava@example.com",
            address: "12, Transport Nagar, Lucknow 226012", km: "85 KM per day", innovation: "Pulsar Fan Zone Van", timing: "8 Hours", extra: {},
        }),
        vehicles: [
            {
                budget: approvedBudget(b({ mileage: 9.5, kmPerDay: 85, salaryPerDay: 875, foodPerDay: 300, haltFood: 1000, from: "Lucknow", to: "Agra", upDownValue: 3800, tolls: [["Lucknow–Kanpur Expressway Toll", 210], ["Agra Expressway Toll", 650]] })),
                allot: { vehicle: "V11", driver: "D10", remarks: "Fan Zone van for UP circuit" },
                clearance: { outcome: "REJECT_RESUBMIT", reason: "Missing Documents", remarks: "Vehicle permit copy is not available for verification.", resubmitRemarks: "Permit copy attached to the vehicle record; resubmitting for clearance." },
            },
            {},
        ],
    },
    {
        key: "P09", type: "SIGNAGE", clientName: "Dabur India Ltd",
        details: signage({ client: "Dabur India Ltd", job: "26110277", location: "Gurugram – Sector 29, Sohna Road, Golf Course Road", vehicles: 1, budget: 72000, from: -18, to: 2, work: "High-rise hoarding and unipole signage installation", site: "Hoarding IDs GGN-07, GGN-12, GGN-19" }),
        vehicles: [
            {
                budget: {
                    v1: b({ mileage: 7, kmPerDay: 50, salaryPerDay: 1000, foodPerDay: 300, haltFood: 0, from: "Gurugram", to: "Sohna", upDownValue: 1500, tolls: [["Kherki Daula Toll Plaza", 100]], others: [["Crane operator support", 3000]] }),
                    rejectV1: { reason: "Days of work are 21 but the salary is budgeted for a shorter period; halt charges are not needed for local work.", fields: [{ field: "salaryAmount", comment: "Recalculate salary for the full campaign." }] },
                    v2: { salaryPerDay: 1000, others: [["Crane operator support", 3000], ["Barricading and safety cones", 1800]] },
                    end: "APPROVED", resubmitComment: "Revised after discussion with RSOM; safety items added.",
                },
                allot: { vehicle: "V12", driver: "D11", remarks: "Ladder truck for high-rise signage", release: "Campaign completed ahead of schedule; ladder truck returned to the Gurugram depot." },
                clearance: { outcome: "APPROVE", deliver: "Ladder truck and driver handed over at the Gurugram depot; odometer reading recorded." },
                payments: [
                    { key: "p09v1-pay1", diesel: [{ amount: 6800, mode: "Fuel Card", reference: "HPCL-FC-55120" }], food: 2400, expenses: [{ optionKey: "TOLL", description: "Delhi–Gurugram NH48 toll", amount: 385 }] },
                    { key: "p09v1-pay2", diesel: [{ amount: 3500, mode: "ePayment", reference: "IOCL-TXN-70215" }], food: 1200, salaryAdvance: 3000, expenses: [{ optionKey: "OTHERS", description: "Final settlement balance", amount: 1500 }] },
                ],
            },
        ],
    },
    {
        key: "P10", type: "ROADSHOW", clientName: "ITC Ltd",
        details: roadshow({
            client: "ITC Ltd", state: "32", vans: 1, start: -2, end: 11, reporting: -2, halt: "NO",
            locations: ["Kochi – Kakkanad", "Thrissur", "Kozhikode"], person: "Jithin Mathew", contact: "94478 15620", email: "jithin.mathew@example.com",
            address: "Door 9/114, Infopark Road, Kakkanad, Kochi 682030", km: "75 KM per day", innovation: "Aashirvaad Sampling Van", timing: "8 Hours", extra: {},
        }),
        vehicles: [
            {
                budget: approvedBudget(b({ mileage: 10.5, kmPerDay: 75, salaryPerDay: 825, foodPerDay: 280, haltFood: 0, from: "Kochi", to: "Kozhikode", upDownValue: 2800, tolls: [["Paliyekkara Toll Plaza", 125], ["Aroor Toll Plaza", 60]] })),
                allot: { vehicle: "V13", driver: "D12", remarks: "Sampling van for Kerala circuit" },
                clearance: { outcome: "PENDING" },
                payments: [{ key: "p10v1-pay1", diesel: [{ amount: 4200, mode: "ePayment", reference: "BPCL-TXN-81340" }], food: 1500, salaryAdvance: 5000, expenses: [{ optionKey: "FUEL", description: "Extra fuel for detour", amount: 800 }, { optionKey: "OTHERS", description: "Advance recovery", amount: 2500, deduct: true }] }],
            },
        ],
    },
];
