/**
 * ═══════════════════════════════════════════════════════════════
 * NAFDAC PMS v3 — NATIONAL CONSTANTS & CONFIGURATION
 * Split: Daily Activities (wizard) vs Separate Log Modules
 * ═══════════════════════════════════════════════════════════════
 */
import { LGA_BY_STATE } from "./lga-data.js";
export { LGA_BY_STATE };

// ── GEO-POLITICAL ZONES → STATES ────────────────────────────────
export const ZONES = {
    "North Central": ["Benue", "Kogi", "Kwara", "Nasarawa", "Niger", "Plateau", "FCT Abuja"],
    "North East":    ["Adamawa", "Bauchi", "Borno", "Gombe", "Taraba", "Yobe"],
    "North West":    ["Jigawa", "Kaduna", "Kano", "Katsina", "Kebbi", "Sokoto", "Zamfara"],
    "South East":    ["Abia", "Anambra", "Ebonyi", "Enugu", "Imo"],
    "South South":   ["Akwa Ibom", "Bayelsa", "Cross River", "Delta", "Edo", "Rivers"],
    "South West":    ["Ekiti", "Lagos", "Ogun", "Ondo", "Osun", "Oyo"]
};

export const ALL_STATES = Object.values(ZONES).flat().sort();

export const getZoneForState = (state) => {
    for (const [zone, states] of Object.entries(ZONES)) {
        if (states.includes(state)) return zone;
    }
    return null;
};

// ── PRODUCT CATEGORIES ──────────────────────────────────────────
export const PRODUCT_CATEGORIES = [
    "Drugs", "Food", "Cosmetics", "Medical Devices",
    "Vaccines & Biologics", "Chemicals", "Herbals", "Water"
];

// ── ROLES & PERMISSIONS ─────────────────────────────────────────
export const ROLES = {
    pending:           { label: "Pending Approval",     level: 0 },
    national_admin:    { label: "Director (National)", level: 4 },
    admin:             { label: "Director (National)", level: 4 },
    zonal_coordinator: { label: "Zonal Coordinator",   level: 3 },
    state_coordinator: { label: "State Coordinator",    level: 2 },
    field_officer:     { label: "Field Officer",        level: 1 },
    inspector:         { label: "Field Officer",        level: 1 }
};

// Navigation sections visible per role
export const NAV_PERMISSIONS = {
    pending:           ['home'],
    field_officer:     ['home', 'activity', 'facilities', 'log-complaints', 'log-adverts', 'log-meetings', 'log-rasff'],
    inspector:         ['home', 'activity', 'facilities', 'log-complaints'],
    state_coordinator: ['home', 'activity', 'facilities', 'log-complaints', 'log-adverts', 'log-meetings', 'log-rasff', 'revenue', 'alerts', 'dashboard', 'team'],
    zonal_coordinator: ['home', 'activity', 'facilities', 'log-complaints', 'log-adverts', 'log-meetings', 'log-rasff', 'revenue', 'alerts', 'dashboard', 'compliance', 'team'],
    national_admin:    ['home', 'activity', 'facilities', 'log-complaints', 'log-adverts', 'log-meetings', 'log-rasff', 'revenue', 'alerts', 'dashboard', 'compliance', 'team'],
    admin:             ['home', 'activity', 'facilities', 'log-complaints', 'log-adverts', 'log-meetings', 'log-rasff', 'revenue', 'alerts', 'dashboard', 'compliance', 'team']
};

// ══════════════════════════════════════════════════════════════════
// DAILY ACTIVITY TYPES (used in the daily wizard)
// ══════════════════════════════════════════════════════════════════

export const DAILY_ACTIVITIES = {
    routine_surveillance: {
        label: "Routine Surveillance",
        icon: "🔍",
        category: "surveillance",
        fields: [
            { name: "productCategory", label: "Product Type", type: "multiselect", options: PRODUCT_CATEGORIES, required: true },
            { name: "facilityName", label: "Facility Name", type: "text", required: true },
            { name: "facilityAddress", label: "Facility Address", type: "text", required: true },
            { name: "actionTaken", label: "Action Taken / Remarks", type: "textarea" }
        ],
        conditionals: [
            {
                trigger: { name: "wasMopUpDone", label: "Was mop-up done?", type: "yesno" },
                fields: [
                    { name: "mopUpDrugs", label: "Drugs", type: "number", inline: true },
                    { name: "mopUpFood", label: "Food", type: "number", inline: true },
                    { name: "mopUpCosmetics", label: "Cosmetics", type: "number", inline: true },
                    { name: "mopUpMedDevices", label: "Medical Devices", type: "number", inline: true },
                    { name: "mopUpVaccines", label: "Vaccines & Biologics", type: "number", inline: true },
                    { name: "mopUpChemicals", label: "Chemicals", type: "number", inline: true },
                    { name: "mopUpHerbals", label: "Herbals", type: "number", inline: true },
                    { name: "mopUpWater", label: "Water", type: "number", inline: true }
                ]
            },
            {
                trigger: { name: "wasProductOnHold", label: "Was any product placed on hold?", type: "yesno" },
                fields: [
                    { name: "holdDrugs", label: "Drugs", type: "number", inline: true },
                    { name: "holdFood", label: "Food", type: "number", inline: true },
                    { name: "holdCosmetics", label: "Cosmetics", type: "number", inline: true },
                    { name: "holdMedDevices", label: "Medical Devices", type: "number", inline: true },
                    { name: "holdVaccines", label: "Vaccines & Biologics", type: "number", inline: true },
                    { name: "holdChemicals", label: "Chemicals", type: "number", inline: true },
                    { name: "holdHerbals", label: "Herbals", type: "number", inline: true },
                    { name: "holdWater", label: "Water", type: "number", inline: true }
                ]
            },
            {
                trigger: { name: "alertProductFound", label: "Was any product on an active alert found?", type: "yesno" },
                fields: [
                    { name: "alertProduct", label: "Alert Product", type: "alertDropdown", placeholder: "Select from active alerts..." },
                    { name: "alertProductDetails", label: "Details", type: "textarea", placeholder: "Describe the alert product(s) found..." }
                ]
            }
        ]
    },

    consumer_complaint: {
        label: "Consumer Complaint",
        icon: "📋",
        category: "surveillance",
        fields: [
            { name: "productCategory", label: "Product Type", type: "multiselect", options: PRODUCT_CATEGORIES, required: true },
            { name: "facilityName", label: "Facility Name", type: "text", required: true },
            { name: "facilityAddress", label: "Facility Address", type: "text", required: true },
            { name: "actionTaken", label: "Action Taken / Remarks", type: "textarea" }
        ],
        conditionals: [
            {
                trigger: { name: "wasMopUpDone", label: "Was mop-up done?", type: "yesno" },
                fields: [
                    { name: "mopUpDrugs", label: "Drugs", type: "number", inline: true },
                    { name: "mopUpFood", label: "Food", type: "number", inline: true },
                    { name: "mopUpCosmetics", label: "Cosmetics", type: "number", inline: true },
                    { name: "mopUpMedDevices", label: "Medical Devices", type: "number", inline: true },
                    { name: "mopUpVaccines", label: "Vaccines & Biologics", type: "number", inline: true },
                    { name: "mopUpChemicals", label: "Chemicals", type: "number", inline: true },
                    { name: "mopUpHerbals", label: "Herbals", type: "number", inline: true },
                    { name: "mopUpWater", label: "Water", type: "number", inline: true }
                ]
            },
            {
                trigger: { name: "wasProductOnHold", label: "Was any product placed on hold?", type: "yesno" },
                fields: [
                    { name: "holdDrugs", label: "Drugs", type: "number", inline: true },
                    { name: "holdFood", label: "Food", type: "number", inline: true },
                    { name: "holdCosmetics", label: "Cosmetics", type: "number", inline: true },
                    { name: "holdMedDevices", label: "Medical Devices", type: "number", inline: true },
                    { name: "holdVaccines", label: "Vaccines & Biologics", type: "number", inline: true },
                    { name: "holdChemicals", label: "Chemicals", type: "number", inline: true },
                    { name: "holdHerbals", label: "Herbals", type: "number", inline: true },
                    { name: "holdWater", label: "Water", type: "number", inline: true }
                ]
            }
        ]
    },

    glsi: {
        label: "GLSI Monitoring",
        icon: "📊",
        category: "surveillance",
        fields: [
            { name: "productCategory", label: "Product Type", type: "multiselect", options: PRODUCT_CATEGORIES, required: true },
            { name: "facilityName", label: "Facility Name", type: "text", required: true },
            { name: "facilityAddress", label: "Facility Address", type: "text", required: true },
            { name: "actionTaken", label: "Action Taken / Remarks", type: "textarea" }
        ],
        conditionals: [
            {
                trigger: { name: "wasMopUpDone", label: "Was mop-up done?", type: "yesno" },
                fields: [
                    { name: "mopUpDrugs", label: "Drugs", type: "number", inline: true },
                    { name: "mopUpFood", label: "Food", type: "number", inline: true },
                    { name: "mopUpCosmetics", label: "Cosmetics", type: "number", inline: true },
                    { name: "mopUpMedDevices", label: "Medical Devices", type: "number", inline: true },
                    { name: "mopUpVaccines", label: "Vaccines & Biologics", type: "number", inline: true },
                    { name: "mopUpChemicals", label: "Chemicals", type: "number", inline: true },
                    { name: "mopUpHerbals", label: "Herbals", type: "number", inline: true },
                    { name: "mopUpWater", label: "Water", type: "number", inline: true }
                ]
            },
            {
                trigger: { name: "wasProductOnHold", label: "Was any product placed on hold?", type: "yesno" },
                fields: [
                    { name: "holdDrugs", label: "Drugs", type: "number", inline: true },
                    { name: "holdFood", label: "Food", type: "number", inline: true },
                    { name: "holdCosmetics", label: "Cosmetics", type: "number", inline: true },
                    { name: "holdMedDevices", label: "Medical Devices", type: "number", inline: true },
                    { name: "holdVaccines", label: "Vaccines & Biologics", type: "number", inline: true },
                    { name: "holdChemicals", label: "Chemicals", type: "number", inline: true },
                    { name: "holdHerbals", label: "Herbals", type: "number", inline: true },
                    { name: "holdWater", label: "Water", type: "number", inline: true }
                ]
            }
        ]
    },

    gsdp: {
        label: "GSDP / CEVI",
        icon: "🏭",
        category: "inspections",
        fields: [
            { name: "gsdpSubtype", label: "Inspection Type", type: "select", options: ["GDP Inspection", "CEVI Inspection"], required: true },
            { name: "facilityName", label: "Facility Name", type: "text", required: true },
            { name: "facilityAddress", label: "Facility Address", type: "text", required: true },
            { name: "riskCategory", label: "Risk Categorization", type: "select", options: ["High Risk", "Medium Risk", "Low Risk"], required: true },
            { name: "activitiesCarriedOut", label: "Activities Carried Out", type: "textarea", required: true },
            { name: "remarks", label: "Remarks", type: "textarea" }
        ]
    },

    lab_report: {
        label: "Lab Report",
        icon: "🧪",
        category: "surveillance",
        fields: [
            { name: "productCategory", label: "Product Type", type: "multiselect", options: PRODUCT_CATEGORIES, required: true },
            { name: "facilityName", label: "Facility Name", type: "text" },
            { name: "facilityAddress", label: "Facility Address", type: "text" },
            { name: "samplesTaken", label: "No. of Samples Taken", type: "number", required: true },
            { name: "remarks", label: "Remarks", type: "textarea" }
        ]
    },

    consultative_meeting: {
        label: "Consultative Meeting",
        icon: "🤝",
        category: "engagement",
        fields: [
            { name: "sourceActivity", label: "Source Activity", type: "select", options: ["Routine Surveillance", "Consumer Complaint", "GLSI Monitoring", "GSDP / CEVI", "Lab Report", "RASFF", "Adverts"], required: true },
            { name: "facilityName", label: "Facility Name", type: "facilitySearchCombo", required: true },
            { name: "outcome", label: "Meeting Outcome / Resolutions", type: "textarea", required: true },
            { name: "actionTaken", label: "Action Taken / Remarks", type: "textarea" }
        ],
        conditionals: [
            {
                trigger: { name: "wasSanctionGiven", label: "Was any sanction given?", type: "yesno" },
                fields: [
                    { name: "sanctionType", label: "Sanction Type", type: "select", options: ["Administrative Charge", "Warning Letter"] },
                    { name: "sanctionAmount", label: "Charge Amount (₦)", type: "number", showWhen: "Administrative Charge" },
                    { name: "sanctionDetails", label: "Sanction Details", type: "textarea" }
                ]
            }
        ]
    }
};

export const DAILY_ACTIVITY_KEYS = Object.keys(DAILY_ACTIVITIES);

// Legacy compat
export const ACTIVITY_TYPES = DAILY_ACTIVITIES;
export const ACTIVITY_KEYS = DAILY_ACTIVITY_KEYS;

// ── COMPLAINT FIELDS ────────────────────────────────────────────
export const COMPLAINT_FIELDS = [
    { name: "complainantName", label: "Complainant Name", type: "text", placeholder: "Full name of complainant" },
    { name: "complainantPhone", label: "Phone Number", type: "text", placeholder: "+234..." },
    { name: "productName", label: "Product Name", type: "text", required: true },
    { name: "productType", label: "Product Type", type: "select", options: PRODUCT_CATEGORIES, required: true },
    { name: "batchNo", label: "Batch Number", type: "text" },
    { name: "nafdacRegNo", label: "NAFDAC Reg. No.", type: "text" },
    { name: "facilityName", label: "Outlet / Place of Purchase", type: "text", required: true },
    { name: "manufacturer", label: "Manufacturer / Importer", type: "text" },
    { name: "natureOfComplaint", label: "Nature of Complaint", type: "select", options: ["Suspected Counterfeit", "Adverse Reaction", "Expired Product", "Poor Quality", "Misleading Label", "Unapproved Product", "Other"], required: true },
    { name: "description", label: "Description of Complaint", type: "textarea", required: true },
    { name: "actionTaken", label: "Action Taken", type: "textarea" },
    { name: "status", label: "Status", type: "select", options: ["Open", "Under Investigation", "Closed"], required: true },
    { name: "remarks", label: "Remarks", type: "textarea" }
];

// ── ADVERT FIELDS ───────────────────────────────────────────────
export const ADVERT_FIELDS = [
    { name: "companyName", label: "Advertiser (Company)", type: "text", required: true },
    { name: "productName", label: "Product Name", type: "text", required: true },
    { name: "nafdacRegNo", label: "NAFDAC Reg. No.", type: "text" },
    { name: "adType", label: "Advertisement Type", type: "select", options: ["TV", "Billboard", "Print", "Online", "Radio", "Social Media"], required: true },
    { name: "approvalDate", label: "Date of NAFDAC Approval", type: "date" },
    { name: "observations", label: "Observations", type: "textarea" },
    { name: "violations", label: "Violations (if any)", type: "textarea" },
    { name: "regulatoryActions", label: "Regulatory Actions", type: "textarea" },
    { name: "remarks", label: "Remarks", type: "textarea" }
];

// ── RASFF FIELDS ────────────────────────────────────────────────
export const RASFF_FIELDS = [
    { name: "dateOfCase", label: "Date of Case", type: "date", required: true },
    { name: "refNo", label: "Reference No.", type: "text", required: true },
    { name: "notifyingCountry", label: "Notifying Country", type: "text", required: true },
    { name: "productType", label: "Type of Product", type: "text", required: true },
    { name: "contaminant", label: "Contaminant", type: "text", required: true },
    { name: "weight", label: "Weight", type: "text" },
    { name: "lotNo", label: "Lot No.", type: "text" },
    { name: "actionsTaken", label: "Action(s) Taken", type: "textarea", required: true },
    { name: "remarks", label: "Remarks", type: "textarea" }
];

// ── MEETING / TRAINING FIELDS ───────────────────────────────────
export const MEETING_FIELDS = [
    { name: "meetingDate", label: "Date", type: "text", required: true, placeholder: "e.g. 25th – 27th March, 2026" },
    { name: "title", label: "Title", type: "text", required: true },
    { name: "venue", label: "Venue", type: "text", required: true },
    { name: "attendees", label: "Attendee(s)", type: "textarea", required: true },
    { name: "facilitator", label: "Facilitator", type: "text" }
];

// ── QMS FIELDS ──────────────────────────────────────────────────
export const QMS_FIELDS = [
    { name: "qmsDate", label: "Date", type: "date", required: true },
    { name: "qmsActivity", label: "QMS Activity Description", type: "textarea", required: true }
];

// ── REVENUE / SANCTION FIELDS ───────────────────────────────────
export const REVENUE_FIELDS = [
    { name: "facilityName", label: "Facility Name", type: "text", required: true, placeholder: "Search or enter facility name..." },
    { name: "sourceActivity", label: "Source Activity", type: "select", options: ["Routine Surveillance", "Consumer Complaint", "GLSI", "GSDP / CEVI", "Lab Report", "RASFF", "Adverts", "Other"], required: true },
    { name: "year", label: "Year", type: "number", required: true, placeholder: "2026" },
    { name: "amount", label: "Amount (₦)", type: "number", required: true },
    { name: "offence", label: "Offence / Reason", type: "textarea", required: true },
    { name: "paymentStatus", label: "Payment Status", type: "select", options: ["Unpaid", "Paid", "Partial"], required: true },
    { name: "remarks", label: "Remarks", type: "textarea" }
];

// ── CLOUDINARY ──────────────────────────────────────────────────
export const CLOUDINARY_UPLOAD_URL = 'https://api.cloudinary.com/v1_1/d1mla94c/upload';
export const CLOUDINARY_UPLOAD_PRESET = 'Daily-Activity';

// ── UTILITY FUNCTIONS ───────────────────────────────────────────
export const formatCurrency = (amount) => {
    if (!amount && amount !== 0) return '—';
    return '₦' + Number(amount).toLocaleString('en-NG');
};

export const getMonthName = (monthNum) => {
    const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
    return months[(monthNum - 1)] || '';
};

export const getCurrentMonth = () => new Date().getMonth() + 1;
export const getCurrentYear = () => new Date().getFullYear();
export const getTodayStr = () => new Date().toISOString().split('T')[0];
