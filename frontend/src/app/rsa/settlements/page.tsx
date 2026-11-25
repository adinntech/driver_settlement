import { redirect } from "next/navigation";

/**
 * The separate Settlement Payments page was folded into Driver Payments (the single place to manage and export payments,
 * including Export Approved (Excel)). Old links and bookmarks land there. Payment Completed (/rsa/settlements/completed) stays.
 */
export default function RsaSettlementsMoved(): never {
  redirect("/rsa/driver-payments");
}
