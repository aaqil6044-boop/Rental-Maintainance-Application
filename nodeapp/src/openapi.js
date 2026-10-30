"use strict";
/**
 * OpenAPI 3 description of the EstateOps API. tests/spec.test.js checks it against the real routes,
 * and validates live responses against these schemas, so it cannot drift from the implementation.
 */
const ref = (n) => ({ $ref: `#/components/schemas/${n}` });
const arr = (n) => ({ type: "array", items: typeof n === "string" ? ref(n) : n });
const S = { type: "string" }, I = { type: "integer" }, N = { type: "number" }, B = { type: "boolean" };
const nul = (t) => (t.$ref ? { allOf: [t], nullable: true } : { ...t, nullable: true });
const obj = (props, required) => ({ type: "object", properties: props, required: required || Object.keys(props) });
const json = (schema) => ({ content: { "application/json": { schema } } });
const body = (schema) => ({ required: true, ...json(schema) });
const res = (description, schema) => ({ description, ...(schema ? json(schema) : {}) });
const E = (d) => ({ description: d, ...json(ref("Error")) });
const ERR = {
  400: E("Validation or business-rule failure"), 401: E("Missing, expired, or signed-out token"),
  403: E("Authenticated, but this role or record is not allowed"), 404: E("Not found (also returned for another organization's records)"),
  409: E("Conflicts with existing data"), 429: E("Too many attempts"), 503: E("A required service is not available"),
};
const errs = (...c) => Object.fromEntries(c.map((x) => [x, ERR[x]]));
const idp = (name = "id") => ({ name, in: "path", required: true, schema: I });
const op = (tag, summary, roles, o) => ({
  tags: [tag], summary,
  description: (roles ? `**Who:** ${roles}.\n\n` : "") + (o.description || ""),
  ...(o.public ? { security: [] } : {}),
  ...(o.params ? { parameters: o.params } : {}),
  ...(o.body ? { requestBody: o.body } : {}),
  responses: o.responses,
});
const ENUMS = {
  Role: ["TENANT", "MANAGER", "TECHNICIAN", "VENDOR"],
  Status: ["REPORTED", "UNDER_REVIEW", "ASSIGNED", "IN_PROGRESS", "COMPLETED", "CLOSED", "REOPENED"],
  Priority: ["LOW", "MEDIUM", "HIGH", "URGENT"],
  Category: ["PLUMBING", "ELECTRICAL", "HVAC", "STRUCTURAL", "APPLIANCE", "OTHER"],
  VendorStatus: ["PENDING", "ACTIVE", "SUSPENDED", "INACTIVE"],
};
const enumSchemas = Object.fromEntries(Object.entries(ENUMS).map(([k, v]) => [k, { type: "string", enum: v }]));

const schemas = {
  ...enumSchemas,
  Error: obj({ timestamp: S, status: I, message: S, code: S, errors: arr(obj({ field: S, message: S })), activeId: I }, ["status", "message"]),
  LoadTestState: { type: "string", enum: ["VALIDATING", "RUNNING", "STOPPING", "COMPLETED", "FAILED", "CANCELLED"] },
  LoadTestVerdict: { type: "string", enum: ["PASSED", "FAILED", "INCONCLUSIVE"] },
  LoadTestBrief: obj({
    id: I, name: S, target: S, state: ref("LoadTestState"), verdict: nul(ref("LoadTestVerdict")), startedBy: obj({ id: I, name: S }),
    createdAt: S, startedAt: nul(S), finishedAt: nul(S), plannedDurationSec: I, maxUsers: I, seed: nul(I),
    peakUsers: nul(I), requests: nul(I), errorRatePct: nul(N), p95Ms: nul(N), avgRps: nul(N), stopReason: nul(S), error: nul(S), createdRecords: I, cleanedUp: B,
    profile: S, orgs: I, knownGood: B, journeysPerSec: nul(N), securityLeaks: nul(I), datasetId: nul(S),
  }, ["id", "name", "target", "state", "startedBy", "createdAt", "createdRecords", "cleanedUp", "profile", "orgs", "knownGood"]),
  LoadTestDetail: { allOf: [ref("LoadTestBrief"), obj({
    config: { type: "object", description: "The validated configuration this run used (no secrets)." },
    summary: nul({ type: "object", description: "Totals, error rate, throughput, exact latency percentiles, status codes, per-endpoint and per-scenario results, recent redacted errors." }),
    timeline: arr({ type: "object", description: "One point per second: target and actual users, requests, errors, rps, p50/p95/p99." }),
    thresholds: arr(obj({ key: S, label: S, limit: N, actual: nul(N), unit: S, passed: B })),
    warnings: arr(S),
    resources: { type: "object", description: "Server-side CPU, memory, event-loop lag and database size, only when the target is this server. `available` says whether they were measured." },
    meta: nul({ type: "object", description: "Application version, git commit, framework and scenario version, environment, dataset id and infrastructure of the run." }),
    isLive: B, elapsedSec: N, phase: nul(S), targetUsers: nul(I), activeUsers: nul(I),
  }, ["config", "thresholds", "warnings", "resources", "isLive"])] },
  LoadTestSetup: obj({
    enabled: B, limits: { type: "object" }, targets: arr(obj({ name: S, kind: S, label: S, host: nul(S), requiresConfirmation: B, available: B, reason: nul(S) })),
    rejectedTargets: arr(obj({ name: S, reason: S })), defaults: { type: "object" }, scenarios: arr({ type: "object" }), activeId: nul(I),
  }),
  LoadTestValidation: obj({ valid: B, errors: arr(obj({ field: S, message: S })), profile: nul({ type: "object" }), warnings: arr(S) }),
  LoadTestRegression: obj({ available: B, reason: nul(S), baseline: nul(obj({ id: I, how: S })),
    comparison: nul({ type: "object", description: "classification (PASS, WARNING, REGRESSION, INCONCLUSIVE), reasons, comparability, findings traced to endpoint/journey/role/stage, limitations." }) }, ["available"]),
  LoadTestTrends: obj({ referenceId: nul(I), runs: arr({ type: "object" }), excluded: I, trends: arr({ type: "object" }) }),
  LoadTestData: obj({ ok: B, orgs: I, accounts: I, leftoverRecords: I, checks: arr(obj({ name: S, ok: B, detail: S })) }),
  LoadTestCompare: obj({ baselineId: I, metrics: arr({ type: "object" }), runs: arr({ type: "object" }), differingSettings: arr(S), notes: arr(S) }),
  LoginResult: obj({ token: S, email: S, fullName: S, role: ref("Role"), accountId: I, emailVerified: B, mfaRequired: B, mfaToken: S }, []),
  SessionView: obj({ id: I, current: B, createdAt: S, lastSeenAt: S, expiresAt: S, device: nul(S), ip: nul(S) }),
  AuthResponse: obj({ token: S, email: S, fullName: S, role: ref("Role"), accountId: I, emailVerified: B }),
  Me: obj({ id: I, email: S, fullName: S, role: ref("Role"), organizationName: nul(S), orgAdmin: B, emailVerified: B, mfaEnabled: B, mfaRequired: B, phone: nul(S), skills: nul(S),
            profileComplete: B, vendorId: nul(I), vendorName: nul(S), vendorStatus: nul(ref("VendorStatus")) }),
  AccountView: obj({ id: I, email: S, fullName: S, role: ref("Role") }),
  TeamMember: obj({ id: I, email: S, fullName: S, role: ref("Role"), active: B, phone: nul(S), skills: nul(S), vendorName: nul(S), orgAdmin: B, createdAt: S }),
  Organization: obj({ name: S, approvalLimit: nul(N), isAdmin: B }),
  SetupStatus: obj({ needsSetup: B, requiresSetupKey: B, selfRegistration: B }),
  InvitationLookup: obj({ email: S, role: ref("Role"), kind: { type: "string", enum: ["INVITE", "RESET"] }, organizationName: S, vendorName: nul(S), unit: nul(S) }),
  Invitation: obj({ id: I, email: S, role: ref("Role"), kind: S, vendorName: nul(S), unit: nul(S), expiresAt: S, createdAt: S }),
  InvitationCreated: { allOf: [ref("Invitation"), obj({ token: S, path: S, emailed: B })] },
  Vendor: obj({ id: I, name: S, contactEmail: S, phone: nul(S), categories: arr(ref("Category")), status: ref("VendorStatus"), memberCount: I, openJobs: I }),
  Property: obj({ id: I, name: S, address: nul(S), propertyType: S, unitCount: I, managerName: S }),
  Unit: obj({ id: I, propertyId: I, propertyName: S, label: S, tenantNames: nul(S) }, ["id", "propertyId", "propertyName", "label"]),
  Request: obj({ id: I, title: S, description: S, category: ref("Category"), priority: ref("Priority"), status: ref("Status"),
    unitLabel: S, propertyName: S, unitId: I, reporterName: S, reporterId: I, technicianName: nul(S), technicianId: nul(I),
    vendorName: nul(S), vendorId: nul(I), completionNotes: nul(S), dueDate: nul(S), overdue: B, createdAt: S, updatedAt: S,
    allowedNext: { ...arr(ref("Status")), description: "Transitions THIS caller may perform right now (already filtered by role and ownership)." } }),
  Comment: obj({ id: I, authorName: S, authorRole: ref("Role"), body: S, createdAt: S }),
  Event: obj({ id: I, actorName: S, fromStatus: nul(S), toStatus: nul(S), note: S, createdAt: S }),
  Attachment: obj({ id: I, name: S, mime: S, sizeBytes: I, kind: { type: "string", enum: ["PHOTO", "EVIDENCE"] }, uploaderName: S, createdAt: S }),
  Expense: obj({ id: I, kind: { type: "string", enum: ["EXPENSE", "INVOICE"] }, amount: N, description: S, recordedByName: S, approved: B, approvedByName: nul(S), createdAt: S }),
  Quotation: obj({ id: I, vendorName: S, amount: N, description: S, status: { type: "string", enum: ["PENDING", "APPROVED", "REJECTED"] }, submittedByName: S, decidedByName: nul(S), createdAt: S }),
  AiSuggestion: obj({ id: I, category: ref("Category"), priority: ref("Priority"), explanation: S, model: S, decision: nul({ type: "string", enum: ["ACCEPTED", "REJECTED"] }), createdAt: S }),
  RequestDetail: obj({
    request: ref("Request"), comments: arr("Comment"), history: arr("Event"), attachments: arr("Attachment"),
    expenses: { ...arr("Expense"), description: "Tenants always get an empty list. Technicians see their own. Vendors see their company's invoices." },
    totalExpense: { ...N, description: "Approved total of the expenses the caller can see." }, pendingExpense: N,
    quotations: { ...arr("Quotation"), description: "Managers see all; a vendor sees its own company's; others get an empty list." },
    aiSuggestion: nul(ref("AiSuggestion")),
  }),
  Notification: obj({ id: I, message: S, requestId: nul(I), read: B, createdAt: S }),
  AiStatus: obj({ configured: B, model: S, provider: S }),
  Dashboard: {
    type: "object",
    required: ["role", "openRequests", "highPriority", "overdue", "inProgress", "completedAwaitingReview", "awaitingAssignment", "closedTotal", "monthlySpend", "pendingSpend", "averageTurnaroundDays", "unreadNotifications", "attention", "recentActivity", "trend", "assignments"],
    description: "Every figure is counted from stored records at request time. Extra fields appear by role: manager (propertyCount, pendingQuotations, pendingApprovals, activeVendors), tenant (units), vendor (vendor, pendingQuotations).",
    properties: {
      role: ref("Role"), openRequests: I, highPriority: I, overdue: I, inProgress: I, completedAwaitingReview: I, awaitingAssignment: I, closedTotal: I,
      monthlySpend: { ...N, description: "Approved expenses and invoices in the last 30 days, within what the caller may see." }, pendingSpend: N,
      averageTurnaroundDays: nul(N), unreadNotifications: I, attention: arr("Request"), recentActivity: arr("Event"),
      trend: arr(obj({ month: S, reported: I, closed: I })), assignments: arr(obj({ name: S, openJobs: I })),
      propertyCount: I, pendingQuotations: I, pendingApprovals: I, activeVendors: I, units: arr("Unit"),
      vendor: obj({ name: S, status: ref("VendorStatus") }),
    },
  },
  Insights: obj({
    method: S,
    recurringIssues: arr(obj({ unitLabel: S, propertyName: S, category: ref("Category"), occurrences: I, explanation: S })),
    costAnomalies: arr(obj({ requestId: I, title: S, category: ref("Category"), amount: N, typicalAmount: N, explanation: S })),
  }),
  AuditEntry: obj({ id: I, actorName: S, action: S, entity: S, entityId: nul(I), detail: nul(S), createdAt: S }),
};

const paths = {
  "/api/setup/status": { get: op("Setup", "Does this installation still need its first manager?", "anyone", { public: true, responses: { 200: res("Status", ref("SetupStatus")) } }) },
  "/api/setup": { post: op("Setup", "Create the organization and its first administrator", "anyone, once, while no accounts exist",
    { public: true, description: "Fails with 409 once any account exists. In production a `setupKey` matching the server's SETUP_KEY is required.",
      body: body(obj({ email: S, password: { ...S, minLength: 8 }, fullName: S, organizationName: S, setupKey: S }, ["email", "password", "fullName", "organizationName"])),
      responses: { 201: res("Created and signed in", ref("AuthResponse")), ...errs(400, 403, 409, 429) } }) },

  "/api/auth/register": { post: op("Authentication", "Sign up as a tenant", "anyone",
    { public: true, description: "Always creates a TENANT with no organization and no units. A `role` or organization in the body is ignored. The tenant can report issues only after a manager links them to a unit.",
      body: body(obj({ email: S, password: { ...S, minLength: 8 }, fullName: S })), responses: { 201: res("Account created", ref("AuthResponse")), ...errs(400, 403, 409, 429) } }) },
  "/api/auth/login": { post: op("Authentication", "Sign in", "anyone",
    { public: true, description: "Eight failed attempts for one email and address lock further attempts for 15 minutes. In production an address is also limited to 60 failed sign-ins per 15 minutes (429).",
      body: body(obj({ email: S, password: S })), responses: { 200: res("Signed in, or (when the account uses two-factor) `mfaRequired: true` with a 5-minute `mfaToken` to send to `/api/auth/mfa/verify`", ref("LoginResult")), ...errs(400, 401, 403, 429) } }) },
  "/api/auth/forgot-password": { post: op("Authentication", "Ask for a password-reset email", "anyone",
    { public: true, description: "Always answers 202, whether or not the address has an account, so it cannot be used to find out who is registered. Limited per address and per email.",
      body: body(obj({ email: S })), responses: { 202: res("Accepted", obj({ message: S })), ...errs(400, 429) } }) },
  "/api/auth/reset-password": { post: op("Authentication", "Choose a new password with an emailed link", "anyone holding the link",
    { public: true, description: "The link works once. Ends every session of the account and confirms the email address.",
      body: body(obj({ token: S, password: { ...S, minLength: 8 } })), responses: { 204: res("Password changed"), ...errs(400, 404, 429) } }) },
  "/api/auth/verify-email": { post: op("Authentication", "Confirm an email address", "anyone holding the link",
    { public: true, body: body(obj({ token: S })), responses: { 204: res("Confirmed"), ...errs(404, 429) } }) },
  "/api/auth/resend-verification": { post: op("Authentication", "Send the verification email again", "any signed-in user",
    { description: "At most 3 per hour. No effect when the address is already confirmed.", responses: { 202: res("Sent", obj({ message: S })), 204: res("Already confirmed"), ...errs(401, 409, 429) } }) },
  "/api/auth/my-data": { get: op("Authentication", "A copy of everything we hold about you", "any signed-in user",
    { description: "Your account, homes, requests, comments, expenses, files, notifications and sign-ins, as a JSON file. Other people's personal data is not included.",
      responses: { 200: res("Your data", obj({ exportedAt: S, about: S, account: obj({}, []) }, [])), ...errs(401) } }) },
  "/api/auth/delete-account": { post: op("Authentication", "Erase your account", "any signed-in user",
    { description: "Needs your password and `confirm: \"DELETE\"`. Your name, email, phone and anything you wrote are removed for good; maintenance records stay, shown as \"Deleted user\". The only administrator of an organization must hand over first.",
      body: body(obj({ password: S, confirm: S })), responses: { 204: res("Erased"), ...errs(400, 401, 409, 429) } }) },
  "/api/accounts/{id}/erase": { post: op("Organization", "Erase someone's personal data", "manager (an organization admin for another manager)",
    { description: "For a request from a person who has left. The account must be deactivated first. Needs `confirm: \"ERASE\"`.", params: [idp()],
      body: body(obj({ confirm: S })), responses: { 200: res("Erased", obj({ id: I, erased: B, already: B })), ...errs(400, 401, 403, 404, 409) } }) },
  "/api/auth/me": { get: op("Authentication", "The signed-in account", "any signed-in user", { responses: { 200: res("Account", ref("Me")), ...errs(401) } }) },
  "/api/auth/logout": { post: op("Authentication", "Sign out this device", "any signed-in user", { description: "Ends only this sign-in; the account's other devices stay signed in.", responses: { 204: res("Signed out"), ...errs(401) } }) },
  "/api/auth/logout-all": { post: op("Authentication", "Sign out everywhere", "any signed-in user", { description: "Invalidates every token issued to this account.", responses: { 204: res("Signed out"), ...errs(401) } }) },
  "/api/auth/sessions": { get: op("Authentication", "Devices signed in to your account", "any signed-in user", { responses: { 200: res("Active sessions", arr("SessionView")), ...errs(401) } }) },
  "/api/auth/sessions/{id}/revoke": { post: op("Authentication", "Sign out one device", "any signed-in user", { params: [idp()], responses: { 204: res("Ended"), ...errs(401, 404) } }) },
  "/api/auth/mfa/verify": { post: op("Authentication", "Finish a two-factor sign-in", "anyone with a fresh `mfaToken`",
    { public: true, description: "Send the 6-digit code from the authenticator app, or one unused recovery code. Failed attempts are limited per address and per account.",
      body: body(obj({ mfaToken: S, code: S })), responses: { 200: res("Signed in", ref("AuthResponse")), ...errs(401, 429) } }) },
  "/api/auth/mfa/setup": { post: op("Authentication", "Start two-factor setup", "any signed-in user", { description: "Needs your password. Returns the key to add to an authenticator app; it is not active until `/api/auth/mfa/enable` accepts a code from it.",
    body: body(obj({ password: S })), responses: { 200: res("Key", obj({ secret: S, otpauthUrl: S })), ...errs(401, 409, 429) } }) },
  "/api/auth/mfa/enable": { post: op("Authentication", "Turn two-factor on", "any signed-in user", { description: "Returns ten single-use recovery codes. They are shown only once.",
    body: body(obj({ code: S })), responses: { 200: res("Enabled", obj({ recoveryCodes: { type: "array", items: S } })), ...errs(400, 401, 409, 429) } }) },
  "/api/auth/mfa/disable": { post: op("Authentication", "Turn two-factor off", "any signed-in user", { description: "Needs your password and a current code (or a recovery code). Ends your other sessions.",
    body: body(obj({ password: S, code: S })), responses: { 204: res("Disabled"), ...errs(401, 409, 429) } }) },
  "/api/accounts/{id}/mfa-reset": { post: op("Organization", "Switch off someone's two-factor sign-in", "manager (an organization admin for another manager)", { description: "For a lost phone with no recovery codes. Ends all that person's sessions.", params: [idp()], responses: { 204: res("Reset"), ...errs(400, 401, 403, 404) } }) },
  "/api/auth/change-password": { post: op("Authentication", "Change your password", "any signed-in user",
    { description: "Signs out all other sessions and returns a fresh token for this one.", body: body(obj({ currentPassword: S, newPassword: { ...S, minLength: 8 } })),
      responses: { 200: res("Changed", obj({ token: S })), ...errs(400, 401, 429) } }) },
  "/api/auth/profile": { put: op("Authentication", "Update your profile", "any signed-in user",
    { body: body(obj({ fullName: S, phone: S, skills: S }, ["fullName"])), responses: { 200: res("Saved", ref("Me")), ...errs(400, 401) } }) },

  "/api/invitations/lookup": { get: op("Invitations", "Look up an invitation link", "anyone holding the link",
    { public: true, params: [{ name: "token", in: "query", required: true, schema: S }], responses: { 200: res("What the link is for", ref("InvitationLookup")), ...errs(404, 429) } }) },
  "/api/invitations/accept": { post: op("Invitations", "Accept an invitation (or complete a password reset)", "anyone holding the link",
    { public: true, description: "The role, organization, vendor and unit come from the invitation. Nothing in the body can change them. A password-reset link only needs `token` and `password`.",
      body: body(obj({ token: S, password: { ...S, minLength: 8 }, fullName: S, phone: S, skills: S }, ["token", "password"])),
      responses: { 201: res("Account created or password set; signed in", ref("AuthResponse")), ...errs(400, 404, 409, 429) } }) },
  "/api/invitations": {
    get: op("Invitations", "Invitations waiting for a reply", "manager", { responses: { 200: res("Pending", arr("Invitation")), ...errs(401, 403) } }),
    post: op("Invitations", "Invite someone into your organization", "manager (only an organization admin may invite a MANAGER)",
      { description: "The link is returned once in `token`/`path`; only its hash is stored. It is also emailed to the person when email is configured (`emailed` says whether that worked); otherwise give them the link.",
        body: body(obj({ email: S, role: ref("Role"), unitId: I, vendorId: I }, ["email", "role"])), responses: { 201: res("Created", ref("InvitationCreated")), ...errs(400, 401, 403, 404, 409) } }) },
  "/api/invitations/{id}/revoke": { post: op("Invitations", "Revoke an invitation", "manager", { params: [idp()], responses: { 204: res("Revoked"), ...errs(401, 403, 404) } }) },

  "/api/organization": {
    get: op("Organization", "Your organization", "manager", { responses: { 200: res("Organization", ref("Organization")), ...errs(401, 403) } }),
    put: op("Organization", "Rename it and set the approval limit", "organization admin",
      { description: "A manager who is not the admin cannot approve an expense above `approvalLimit`.", body: body(obj({ name: S, approvalLimit: nul(N) }, ["name"])),
        responses: { 200: res("Saved", ref("Organization")), ...errs(400, 401, 403) } }) },
  "/api/team": { get: op("Organization", "Everyone in your organization", "manager", { responses: { 200: res("People", arr("TeamMember")), ...errs(401, 403) } }) },
  "/api/technicians": { get: op("Organization", "Active technicians in your organization", "manager", { responses: { 200: res("Technicians", arr(obj({ id: I, email: S, fullName: S, role: ref("Role"), skills: nul(S) }))), ...errs(401, 403) } }) },
  "/api/tenants": { get: op("Organization", "Active tenants in your organization", "manager", { responses: { 200: res("Tenants", arr("AccountView")), ...errs(401, 403) } }) },
  "/api/accounts": { post: op("Organization", "Create an account directly", "manager (only an admin may create a MANAGER)",
    { description: "For when you hand someone a password in person. Prefer invitations.",
      body: body(obj({ email: S, password: { ...S, minLength: 8 }, fullName: S, role: ref("Role"), vendorId: I, skills: S }, ["email", "password", "fullName", "role"])),
      responses: { 201: res("Created", ref("AccountView")), ...errs(400, 401, 403, 404, 409) } }) },
  "/api/accounts/{id}/status": { post: op("Organization", "Deactivate or reactivate an account", "manager",
    { description: "Deactivating signs the person out immediately.", params: [idp()], body: body(obj({ active: B })),
      responses: { 200: res("Updated", obj({ id: I, active: B })), ...errs(400, 401, 403, 404) } }) },
  "/api/accounts/{id}/reset-link": { post: op("Organization", "Issue a one-time password reset link", "manager",
    { description: "Valid for `RESET_LINK_HOURS` (24 by default). Also emailed to the account when email is configured (`emailed`).", params: [idp()], responses: { 201: res("Created", ref("InvitationCreated")), ...errs(400, 401, 403, 404) } }) },

  "/api/vendors": {
    get: op("Vendors", "Vendor companies", "manager", { params: [{ name: "status", in: "query", schema: ref("VendorStatus") }], responses: { 200: res("Vendors", arr("Vendor")), ...errs(400, 401, 403) } }),
    post: op("Vendors", "Add a vendor company (starts PENDING)", "manager",
      { body: body(obj({ name: S, contactEmail: S, phone: S, categories: arr(ref("Category")) }, ["name", "contactEmail"])), responses: { 201: res("Created", ref("Vendor")), ...errs(400, 401, 403, 409) } }) },
  "/api/vendors/{id}/status": { post: op("Vendors", "Approve, suspend or deactivate a vendor", "manager",
    { description: "Only ACTIVE vendors can be assigned work. A vendor that is not ACTIVE loses sight of its work orders.", params: [idp()], body: body(obj({ status: ref("VendorStatus") })),
      responses: { 200: res("Updated", ref("Vendor")), ...errs(400, 401, 403, 404) } }) },
  "/api/vendors/me": {
    get: op("Vendors", "My company", "vendor", { responses: { 200: res("Company", ref("Vendor")), ...errs(401, 403) } }),
    put: op("Vendors", "Update my company's phone and services", "vendor", { body: body(obj({ phone: S, categories: arr(ref("Category")) }, [])), responses: { 200: res("Saved", ref("Vendor")), ...errs(400, 401, 403) } }) },

  "/api/properties": {
    get: op("Properties and units", "Your properties", "manager", { responses: { 200: res("Properties", arr("Property")), ...errs(401, 403) } }),
    post: op("Properties and units", "Add a property", "manager", { body: body(obj({ name: S, address: S, propertyType: S }, ["name"])), responses: { 201: res("Created", ref("Property")), ...errs(400, 401, 403) } }) },
  "/api/properties/{id}/units": { get: op("Properties and units", "Units in a property, with their tenants", "manager", { params: [idp()], responses: { 200: res("Units", arr("Unit")), ...errs(401, 403, 404) } }) },
  "/api/units": { post: op("Properties and units", "Add a unit", "manager", { description: "A label must be unique within its property (case-insensitive).", body: body(obj({ propertyId: I, label: S })), responses: { 201: res("Created", ref("Unit")), ...errs(400, 401, 403, 404, 409) } }) },
  "/api/units/reportable": { get: op("Properties and units", "Units the caller may report an issue for", "tenant (their linked units) or manager (all units)", { responses: { 200: res("Units", arr("Unit")), ...errs(401, 403) } }) },
  "/api/units/{unitId}/tenants": { post: op("Properties and units", "Link a tenant to a unit (manager approval of the tenancy)", "manager",
    { description: "Finds an existing tenant account by email. A tenant who belongs to another organization is refused. This is the only way, apart from an invitation, that a tenant gains access to a unit.",
      params: [idp("unitId")], body: body(obj({ email: S })), responses: { 204: res("Linked"), ...errs(400, 401, 403, 404, 409) } }) },

  "/api/maintenance-requests": {
    get: op("Maintenance requests", "Requests in the caller's scope", "any signed-in user",
      { description: "Managers: their organization. Tenants: requests they reported. Technicians: jobs assigned to them. Vendors: work orders for their ACTIVE company. Search and filters run in the database. The total is in the `X-Total-Count` header.",
        params: [{ name: "q", in: "query", schema: S, description: "Matches title, description, unit and property" }, { name: "status", in: "query", schema: ref("Status") }, { name: "priority", in: "query", schema: ref("Priority") },
                 { name: "category", in: "query", schema: ref("Category") }, { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 200, default: 100 } }, { name: "offset", in: "query", schema: { type: "integer", minimum: 0, default: 0 } }],
        responses: { 200: { description: "Requests", headers: { "X-Total-Count": { schema: I, description: "Total matches before paging" } }, ...json(arr("Request")) }, ...errs(400, 401) } }),
    post: op("Maintenance requests", "Report an issue", "tenant (own units only) or manager",
      { body: body(obj({ unitId: I, title: { ...S, maxLength: 160 }, description: { ...S, maxLength: 4000 }, category: ref("Category"), priority: ref("Priority") }, ["unitId", "title", "description"])),
        responses: { 201: res("Created as REPORTED", ref("Request")), ...errs(400, 401, 403, 404) } }) },
  "/api/maintenance-requests/{id}": { get: op("Maintenance requests", "One request with everything the caller may see", "tenant who reported it, manager of its organization, assigned technician, assigned vendor's staff",
    { params: [idp()], responses: { 200: res("Detail", ref("RequestDetail")), ...errs(401, 403, 404) } }) },
  "/api/maintenance-requests/{id}/status": { post: op("Maintenance requests", "Move a request to another status", "see rules",
    { description: "Role check comes first (403), then the lifecycle check (400). UNDER_REVIEW, ASSIGNED and CLOSED: manager. IN_PROGRESS and COMPLETED: assigned technician, assigned vendor staff or manager. REOPENED: manager or the reporter. COMPLETED needs `completionNotes`. Every change is written to the request history and the audit log.",
      params: [idp()], body: body(obj({ target: ref("Status"), note: S, completionNotes: S }, ["target"])), responses: { 200: res("Updated", ref("Request")), ...errs(400, 401, 403, 404) } }) },
  "/api/maintenance-requests/{id}/assign": { post: op("Maintenance requests", "Assign a technician or a vendor", "manager",
    { description: "Exactly one of `technicianId` or `vendorId`. The technician must be active in your organization; the vendor must be ACTIVE. Possible while REPORTED, UNDER_REVIEW, ASSIGNED or REOPENED.",
      params: [idp()], body: body(obj({ technicianId: I, vendorId: I, dueDate: { ...S, format: "date" }, priority: ref("Priority"), category: ref("Category") }, [])), responses: { 200: res("Assigned", ref("Request")), ...errs(400, 401, 403, 404) } }) },
  "/api/maintenance-requests/{id}/comments": { post: op("Maintenance requests", "Add a comment", "anyone who can see the request",
    { description: "Refused while the request is CLOSED.", params: [idp()], body: body(obj({ body: { ...S, maxLength: 2000 } })), responses: { 201: res("Added", ref("Comment")), ...errs(400, 401, 403, 404) } }) },
  "/api/maintenance-requests/{id}/expenses": { post: op("Expenses and quotations", "Record an expense (or, for a vendor, an invoice)", "manager, technician, vendor",
    { description: "Stored as whole minor units. A vendor's record is typed INVOICE. Needs approval by a manager who did not record it. Refused while CLOSED.", params: [idp()],
      body: body(obj({ amount: { ...N, exclusiveMinimum: 0 }, description: S })), responses: { 201: res("Recorded, unapproved", ref("Expense")), ...errs(400, 401, 403, 404) } }) },
  "/api/maintenance-requests/{id}/quotations": { post: op("Expenses and quotations", "Submit a quotation", "vendor staff for an assigned request",
    { params: [idp()], body: body(obj({ amount: { ...N, exclusiveMinimum: 0 }, description: S })), responses: { 201: res("Submitted", ref("Quotation")), ...errs(400, 401, 403, 404) } }) },
  "/api/maintenance-requests/{id}/attachments": { post: op("Files", "Upload a photo or document", "anyone who can see the request",
    { description: "Multipart field `file`. PNG, JPEG, WebP or PDF up to 5 MB, identified by the file's own bytes (the name and declared type are not trusted). At most 10 per request. Tenants' files are PHOTO; everyone else's are EVIDENCE.",
      params: [idp()], body: { required: true, content: { "multipart/form-data": { schema: { type: "object", required: ["file"], properties: { file: { type: "string", format: "binary" } } } } } },
      responses: { 201: res("Stored", ref("Attachment")), ...errs(400, 401, 403, 404) } }) },
  "/api/maintenance-requests/{id}/ai-suggestion": { post: op("AI", "Ask the AI for a category and priority", "manager",
    { description: "Sends only the title and description. Returns 503 `AI_NOT_CONFIGURED` when no key is set, 503 `AI_RATE_LIMITED`, 504 `AI_TIMEOUT`, or 502 `AI_BAD_RESPONSE`/`AI_UNREACHABLE`. Never a made-up result.",
      params: [idp()], responses: { 201: res("Suggestion saved, undecided", ref("AiSuggestion")), ...errs(401, 403, 404, 503), 502: E("The AI service failed or returned an invalid answer"), 504: E("The AI service timed out") } }) },

  "/api/attachments/{id}": { get: op("Files", "Download a file", "anyone who can see its request", { description: "Returns the file bytes. Send the Authorization header; a plain link will not work.", params: [idp()],
    responses: { 200: { description: "The file", content: { "image/png": { schema: { type: "string", format: "binary" } }, "application/pdf": { schema: { type: "string", format: "binary" } } } }, ...errs(401, 403, 404) } }) },
  "/api/expenses/{id}/approve": { post: op("Expenses and quotations", "Approve an expense or invoice", "manager other than the person who recorded it",
    { description: "Above the organization's approval limit only the admin may approve.", params: [idp()], responses: { 200: res("Approved", ref("Expense")), ...errs(400, 401, 403, 404) } }) },
  "/api/quotations/{id}/decision": { post: op("Expenses and quotations", "Approve or reject a quotation", "manager",
    { params: [idp()], body: body(obj({ decision: { type: "string", enum: ["APPROVE", "REJECT"] } })), responses: { 200: res("Decided", ref("Quotation")), ...errs(400, 401, 403, 404) } }) },
  "/api/ai-suggestions/{id}/decision": { post: op("AI", "Accept or ignore an AI suggestion", "manager",
    { description: "Accepting applies the category and priority to the request and records it in the history.", params: [idp()], body: body(obj({ decision: { type: "string", enum: ["ACCEPT", "REJECT"] } })),
      responses: { 200: res("Decided", ref("AiSuggestion")), ...errs(400, 401, 403, 404) } }) },
  "/api/ai/status": { get: op("AI", "Is the AI service configured?", "manager", { responses: { 200: res("Status", ref("AiStatus")), ...errs(401, 403) } }) },

  "/api/notifications": { get: op("Notifications", "My latest 50 notifications", "any signed-in user", { responses: { 200: res("Notifications", arr("Notification")), ...errs(401) } }) },
  "/api/notifications/{id}/read": { post: op("Notifications", "Mark one as read", "its recipient", { params: [idp()], responses: { 204: res("Marked"), ...errs(401, 403, 404) } }) },
  "/api/notifications/read-all": { post: op("Notifications", "Mark all of mine as read", "any signed-in user", { responses: { 204: res("Marked"), ...errs(401) } }) },

  "/api/dashboard": { get: op("Dashboard and reports", "Figures for the caller's own scope", "any signed-in user", { responses: { 200: res("Dashboard", ref("Dashboard")), ...errs(401) } }) },
  "/api/insights": { get: op("Dashboard and reports", "Repeat problems and unusual costs", "manager", { description: "Rule-based analysis of stored records. It is not an AI model.", responses: { 200: res("Insights", ref("Insights")), ...errs(401, 403) } }) },
  "/api/audit": { get: op("Dashboard and reports", "Administrative and financial audit trail", "manager", { params: [{ name: "limit", in: "query", schema: { type: "integer", maximum: 200, default: 100 } }], responses: { 200: res("Entries, newest first", arr("AuditEntry")), ...errs(401, 403) } }) },

  "/api/loadtests/config": { get: op("Load testing", "Limits, targets, defaults and the scenario catalogue", "organization admin", { responses: { 200: res("Setup", ref("LoadTestSetup")), ...errs(401, 403) } }) },
  "/api/loadtests/validate": { post: op("Load testing", "Check a configuration without starting it", "organization admin", {
    description: "Returns every problem found, and for a valid configuration the planned load profile (the total duration includes the ramp-up and ramp-down).",
    body: body({ type: "object", description: "Any subset of the configuration; missing fields use the defaults." }), responses: { 200: res("Result", ref("LoadTestValidation")), ...errs(401, 403) } }) },
  "/api/loadtests/stop-all": { post: op("Load testing", "Emergency stop", "organization admin", { description: "Ends all traffic immediately, for any organization. Use it if the target is struggling.", responses: { 200: res("Stopped", obj({ stopped: I })), ...errs(401, 403) } }) },
  "/api/loadtests/cleanup": { post: op("Load testing", "Delete all load-test records in my organization", "organization admin", {
    description: "Deletes only requests reported by a load-test account whose title starts with `[LOADTEST r`, and the notifications they caused. Refused while a test is running.",
    responses: { 200: res("Deleted", obj({ requests: I, notifications: I })), ...errs(401, 403, 409) } }) },
  "/api/loadtests/data": { get: op("Load testing", "Check the integrity of the synthetic test data", "organization admin", { description: "Confirms fixtures are clearly labelled, hidden when idle, and that no test records are left behind.", responses: { 200: res("Checks", ref("LoadTestData")), ...errs(401, 403) } }) },
  "/api/loadtests/trends": { get: op("Load testing", "Trends across comparable runs", "organization admin", {
    description: "p95, p99, throughput and error rate across earlier runs that were measured under comparable conditions, with a flag for gradual degradation.",
    params: [{ name: "runId", in: "query", schema: I, description: "Reference run (default: the latest completed run)" }, { name: "limit", in: "query", schema: { type: "integer", minimum: 2, maximum: 30, default: 10 } }],
    responses: { 200: res("Trends", ref("LoadTestTrends")), ...errs(401, 403, 404) } }) },
  "/api/loadtests/compare": { get: op("Load testing", "Compare 2 to 5 runs", "organization admin", {
    description: "The first id is the baseline. Differences carry the direction that counts as better (lower latency and error rate, higher throughput).",
    params: [{ name: "ids", in: "query", required: true, schema: S, description: "Comma-separated run ids, e.g. 4,5,6" }], responses: { 200: res("Comparison", ref("LoadTestCompare")), ...errs(400, 401, 403, 404) } }) },
  "/api/loadtests": {
    get: op("Load testing", "Previous and current runs", "organization admin", { params: [{ name: "limit", in: "query", schema: { type: "integer", maximum: 200, default: 50 } }], responses: { 200: res("Runs, newest first", arr("LoadTestBrief")), ...errs(401, 403) } }),
    post: op("Load testing", "Start a load test", "organization admin", {
      description: "Validates the configuration on the server, enforces the safety limits, and starts one run. Only one run can be active (409 otherwise). Non-local targets need `confirmTarget` set to the target name.",
      body: body({ type: "object", description: "See GET /api/loadtests/config for every option, its default and its limit." }), responses: { 201: res("Started", ref("LoadTestDetail")), ...errs(400, 401, 403, 409) } }) },
  "/api/loadtests/{id}": { get: op("Load testing", "One run: configuration, live or final results, thresholds, warnings", "organization admin", { params: [idp()], responses: { 200: res("Run", ref("LoadTestDetail")), ...errs(401, 403, 404) } }) },
  "/api/loadtests/{id}/stop": { post: op("Load testing", "Stop (graceful) or cancel (immediate) a running test", "organization admin", {
    description: "`graceful` (default) lets users finish their current request. `now` aborts in-flight requests. Either way the run ends as CANCELLED with an INCONCLUSIVE verdict and its partial results are kept.",
    params: [idp()], body: { required: false, ...json(obj({ mode: { type: "string", enum: ["graceful", "now"] } }, [])) }, responses: { 200: res("Stopping", ref("LoadTestDetail")), ...errs(400, 401, 403, 404, 409) } }) },
  "/api/loadtests/{id}/cleanup": { post: op("Load testing", "Delete the records created by one run", "organization admin", {
    params: [idp()], responses: { 200: res("Deleted", obj({ requests: I, notifications: I })), ...errs(400, 401, 403, 404, 409) } }) },
  "/api/loadtests/{id}/regression": { get: op("Load testing", "Compare a run with a baseline and classify it", "organization admin", {
    description: "Classifies the run PASS, WARNING, REGRESSION or INCONCLUSIVE against the previous comparable run, a chosen run or the known-good reference. Differences are traced to endpoint, journey, role and load stage. Runs measured under different conditions are never given a definitive verdict.",
    params: [idp(), { name: "baseline", in: "query", schema: S, description: '"previous" (default), "known-good" or a run id' }], responses: { 200: res("Regression analysis", ref("LoadTestRegression")), ...errs(400, 401, 403, 404) } }) },
  "/api/loadtests/{id}/known-good": { post: op("Load testing", "Mark or unmark a run as the known-good reference", "organization admin", {
    params: [idp()], body: body(obj({ value: B })), responses: { 200: res("Updated run", ref("LoadTestDetail")), ...errs(400, 401, 403, 404) } }) },
  "/api/loadtests/{id}/export": { get: op("Load testing", "Download a run as JSON, CSV or a self-contained HTML report", "organization admin", {
    params: [idp(), { name: "format", in: "query", schema: { type: "string", enum: ["json", "csv", "html"], default: "json" } }, { name: "baseline", in: "query", description: 'HTML only: "previous" (default), "known-good", a run id, or "none"', schema: S },
      { name: "part", in: "query", description: "CSV only", schema: { type: "string", enum: ["summary", "endpoints", "scenarios", "timeline", "errors", "thresholds"], default: "summary" } }],
    responses: { 200: { description: "File", content: { "application/json": { schema: { type: "object" } }, "text/csv": { schema: S }, "text/html": { schema: S } } }, ...errs(400, 401, 403, 404) } }) },
  "/health": { get: op("Platform", "Liveness and database check", "anyone", { public: true, responses: { 200: res("Up", obj({ status: S, database: S })), 503: res("Database unreachable") } }) },
};

module.exports = {
  openapi: "3.0.3",
  info: {
    title: "EstateOps API", version: "2.0.0",
    description: "Rental maintenance and property management.\n\n" +
      "**Signing in.** Call `POST /api/auth/login`, copy `token`, press **Authorize** and paste it. A new installation is created with `POST /api/setup`.\n\n" +
      "**Roles.** TENANT, MANAGER, TECHNICIAN, VENDOR. Roles and organization scope come from the signed-in account on the server, never from a request body. Another organization's records answer 404 (or 403 for requests).\n\n" +
      "**Lifecycle.** REPORTED → UNDER_REVIEW → ASSIGNED → IN_PROGRESS → COMPLETED → CLOSED, with REOPENED re-entering at ASSIGNED or UNDER_REVIEW. A manager may also assign straight from REPORTED.\n\n" +
      "**Errors.** `{ timestamp, status, message, code? }`.",
  },
  servers: [{ url: "/" }],
  tags: ["Setup", "Authentication", "Invitations", "Organization", "Vendors", "Properties and units", "Maintenance requests", "Expenses and quotations", "Files", "AI", "Notifications", "Dashboard and reports", "Load testing", "Platform"].map((name) => ({ name })),
  security: [{ bearerAuth: [] }],
  components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" } }, schemas },
  paths,
};
