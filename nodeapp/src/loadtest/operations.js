"use strict";
// Business operations: groups of endpoints that a person would call one action ("create a complaint", "approve a quotation").
// Endpoint latency answers "how fast is this URL"; operation latency answers "how fast is this thing people do".
const OPS = [
  [/^POST \/api\/auth\/login/, "Login"],
  [/^GET \/api\/dashboard/, "Dashboard"],
  [/^POST \/api\/maintenance-requests$/, "Complaint creation"],
  [/^GET \/api\/maintenance-requests$/, "Request list and search"],
  [/^GET \/api\/maintenance-requests\/\{id\}$/, "Request detail"],
  [/^POST \/api\/maintenance-requests\/\{id\}\/comments$/, "Comment"],
  [/^POST \/api\/maintenance-requests\/\{id\}\/status$/, "Status change"],
  [/^POST \/api\/maintenance-requests\/\{id\}\/assign$/, "Assignment (technician or vendor)"],
  [/^POST \/api\/maintenance-requests\/\{id\}\/quotations$/, "Quotation submission"],
  [/^POST \/api\/quotations\/\{id\}\/decision$/, "Quotation approval"],
  [/^POST \/api\/maintenance-requests\/\{id\}\/expenses$/, "Expense or invoice recording"],
  [/^POST \/api\/expenses\/\{id\}\/approve$/, "Expense or invoice approval"],
  [/^GET \/api\/(insights|audit|properties|team|organization|invitations|technicians)/, "Reports and administration"],
  [/^GET \/api\/vendors/, "Vendor directory and profile"],
  [/^GET \/api\/notifications/, "Notifications"],
  [/^GET \/api\/units/, "Unit lookup"],
];
function operationOf(key) { for (const [re, name] of OPS) if (re.test(key)) return name; return "Other"; }
module.exports = { operationOf, OPS };
