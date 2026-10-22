-- =====================================================================
-- Property Management & Maintenance Platform
-- Physical Database Model  --  MySQL 8.0 (InnoDB, utf8mb4)
-- Derived from the Logical Database Design (DDD v2.0)
--
-- Conventions
--   * One physical database; module ownership shown by table-name prefix
--     (identity_, property_, occupancy_, onboarding_, maintenance_,
--      vendor_, billing_, notif_, ai_, shared_).
--   * Surrogate keys: CHAR(36) UUID (DEFAULT (UUID()); app may supply).
--     For denser storage switch to BINARY(16) + app-side conversion.
--   * Within-module foreign keys are enforced.
--     Cross-module references are plain indexed columns WITHOUT an FK,
--     to keep modules decoupled (see logical design section 16).
--     Such columns are marked  -- xref: <target>
--   * Money: DECIMAL(14,2) + CHAR(3) currency.
--   * Timestamps: DATETIME(6) UTC.
--   * Booleans: TINYINT(1).  Enums: native MySQL ENUM.
-- Requires MySQL 8.0.16+ (CHECK constraints, functional defaults).
-- =====================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

CREATE DATABASE IF NOT EXISTS property_maintenance
  CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE property_maintenance;

-- =====================================================================
-- MODULE: identity  (Identity & Access)
-- =====================================================================

CREATE TABLE identity_organization (
  id            CHAR(36)     NOT NULL DEFAULT (UUID()),
  name          VARCHAR(200) NOT NULL,
  status        ENUM('active','suspended') NOT NULL DEFAULT 'active',
  created_at    DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at    DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id)
) ENGINE=InnoDB;

CREATE TABLE identity_app_user (
  id            CHAR(36)     NOT NULL DEFAULT (UUID()),
  email         VARCHAR(255) NOT NULL,
  full_name     VARCHAR(200) NULL,
  phone         VARCHAR(40)  NULL,
  password_hash VARCHAR(255) NULL,
  status        ENUM('invited','active','disabled') NOT NULL DEFAULT 'invited',
  created_at    DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at    DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_app_user_email (email)
) ENGINE=InnoDB;

CREATE TABLE identity_organization_membership (
  id              CHAR(36) NOT NULL DEFAULT (UUID()),
  user_id         CHAR(36) NOT NULL,
  organization_id CHAR(36) NOT NULL,
  status          ENUM('active','revoked') NOT NULL DEFAULT 'active',
  created_at      DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_membership (user_id, organization_id),
  KEY ix_membership_org (organization_id),
  CONSTRAINT fk_membership_user FOREIGN KEY (user_id)
      REFERENCES identity_app_user (id),
  CONSTRAINT fk_membership_org FOREIGN KEY (organization_id)
      REFERENCES identity_organization (id)
) ENGINE=InnoDB;

CREATE TABLE identity_role (
  id              CHAR(36) NOT NULL DEFAULT (UUID()),
  organization_id CHAR(36) NULL,                 -- NULL = platform/global role
  name            ENUM('super_admin','org_admin','approver',
                       'property_manager','owner','tenant','vendor') NOT NULL,
  PRIMARY KEY (id),
  KEY ix_role_org (organization_id),
  CONSTRAINT fk_role_org FOREIGN KEY (organization_id)
      REFERENCES identity_organization (id)
) ENGINE=InnoDB;

CREATE TABLE identity_resource_scope (
  id              CHAR(36) NOT NULL DEFAULT (UUID()),
  scope_type      ENUM('organization','property','building','unit','work_order') NOT NULL,
  resource_id     CHAR(36) NOT NULL,             -- xref: target resource (validated by app)
  organization_id CHAR(36) NOT NULL,
  PRIMARY KEY (id),
  KEY ix_scope_org (organization_id),
  KEY ix_scope_lookup (scope_type, resource_id)
) ENGINE=InnoDB;

CREATE TABLE identity_role_assignment (
  id            CHAR(36) NOT NULL DEFAULT (UUID()),
  membership_id CHAR(36) NOT NULL,
  role_id       CHAR(36) NOT NULL,
  scope_id      CHAR(36) NOT NULL,
  granted_at    DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  granted_by    CHAR(36) NULL,
  PRIMARY KEY (id),
  KEY ix_ra_membership (membership_id),
  KEY ix_ra_scope (scope_id),
  CONSTRAINT fk_ra_membership FOREIGN KEY (membership_id)
      REFERENCES identity_organization_membership (id),
  CONSTRAINT fk_ra_role FOREIGN KEY (role_id)
      REFERENCES identity_role (id),
  CONSTRAINT fk_ra_scope FOREIGN KEY (scope_id)
      REFERENCES identity_resource_scope (id)
) ENGINE=InnoDB;

CREATE TABLE identity_permission (
  id      CHAR(36)     NOT NULL DEFAULT (UUID()),
  role_id CHAR(36)     NOT NULL,
  action  VARCHAR(100) NOT NULL,                 -- e.g. request.create, workorder.assign
  PRIMARY KEY (id),
  UNIQUE KEY uq_permission (role_id, action),
  CONSTRAINT fk_permission_role FOREIGN KEY (role_id)
      REFERENCES identity_role (id)
) ENGINE=InnoDB;

CREATE TABLE identity_access_grant (
  id         CHAR(36) NOT NULL DEFAULT (UUID()),
  user_id    CHAR(36) NOT NULL,
  scope_id   CHAR(36) NOT NULL,
  valid_from DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  valid_to   DATETIME(6) NULL,                   -- NULL = open-ended
  revoked_at DATETIME(6) NULL,                   -- NULL = active
  PRIMARY KEY (id),
  KEY ix_grant_user (user_id),
  KEY ix_grant_scope (scope_id),
  CONSTRAINT fk_grant_user FOREIGN KEY (user_id)
      REFERENCES identity_app_user (id),
  CONSTRAINT fk_grant_scope FOREIGN KEY (scope_id)
      REFERENCES identity_resource_scope (id)
) ENGINE=InnoDB;

-- =====================================================================
-- MODULE: property  (Property Portfolio)
-- =====================================================================

CREATE TABLE property_property (
  id              CHAR(36) NOT NULL DEFAULT (UUID()),
  organization_id CHAR(36) NOT NULL,             -- xref: identity_organization
  name            VARCHAR(200) NOT NULL,
  property_type   ENUM('house','single_building','complex') NOT NULL,
  address_line    VARCHAR(255) NULL,
  city            VARCHAR(120) NULL,
  region          VARCHAR(120) NULL,
  postal_code     VARCHAR(20)  NULL,
  country         VARCHAR(80)  NULL,
  status          ENUM('draft','active','suspended','deactivated') NOT NULL DEFAULT 'draft',
  created_at      DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at      DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY ix_property_org (organization_id, status)
) ENGINE=InnoDB;

CREATE TABLE property_building (
  id              CHAR(36) NOT NULL DEFAULT (UUID()),
  property_id     CHAR(36) NOT NULL,
  organization_id CHAR(36) NOT NULL,
  name            VARCHAR(120) NOT NULL,
  status          ENUM('active','deactivated') NOT NULL DEFAULT 'active',
  PRIMARY KEY (id),
  UNIQUE KEY uq_building_name (property_id, name),
  KEY ix_building_org (organization_id),
  CONSTRAINT fk_building_property FOREIGN KEY (property_id)
      REFERENCES property_property (id)
) ENGINE=InnoDB;

CREATE TABLE property_floor (
  id              CHAR(36) NOT NULL DEFAULT (UUID()),
  building_id     CHAR(36) NOT NULL,
  organization_id CHAR(36) NOT NULL,
  label           VARCHAR(60) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_floor_label (building_id, label),
  KEY ix_floor_org (organization_id),
  CONSTRAINT fk_floor_building FOREIGN KEY (building_id)
      REFERENCES property_building (id)
) ENGINE=InnoDB;

CREATE TABLE property_unit (
  id              CHAR(36) NOT NULL DEFAULT (UUID()),
  organization_id CHAR(36) NOT NULL,
  property_id     CHAR(36) NOT NULL,
  building_id     CHAR(36) NULL,
  floor_id        CHAR(36) NULL,
  unit_identifier VARCHAR(60) NOT NULL,
  status          ENUM('active','deactivated') NOT NULL DEFAULT 'active',
  created_at      DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at      DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_unit_identifier (property_id, unit_identifier),
  KEY ix_unit_org (organization_id),
  KEY ix_unit_building (building_id),
  KEY ix_unit_floor (floor_id),
  CONSTRAINT fk_unit_property FOREIGN KEY (property_id)
      REFERENCES property_property (id),
  CONSTRAINT fk_unit_building FOREIGN KEY (building_id)
      REFERENCES property_building (id),
  CONSTRAINT fk_unit_floor FOREIGN KEY (floor_id)
      REFERENCES property_floor (id)
) ENGINE=InnoDB;

-- =====================================================================
-- MODULE: occupancy  (Ownership & Tenancy)
-- =====================================================================

CREATE TABLE occupancy_party (
  id              CHAR(36) NOT NULL DEFAULT (UUID()),
  organization_id CHAR(36) NOT NULL,             -- xref: identity_organization
  user_id         CHAR(36) NULL,                 -- xref: identity_app_user (NULL = no login)
  full_name       VARCHAR(200) NULL,
  contact_email   VARCHAR(255) NULL,
  contact_phone   VARCHAR(40)  NULL,
  party_type      ENUM('individual','company') NOT NULL DEFAULT 'individual',
  PRIMARY KEY (id),
  KEY ix_party_org (organization_id),
  KEY ix_party_user (user_id)
) ENGINE=InnoDB;

CREATE TABLE occupancy_ownership (
  id              CHAR(36) NOT NULL DEFAULT (UUID()),
  organization_id CHAR(36) NOT NULL,
  unit_id         CHAR(36) NOT NULL,             -- xref: property_unit
  owner_party_id  CHAR(36) NOT NULL,
  share           DECIMAL(6,4) NOT NULL DEFAULT 1.0000,   -- 0..1
  effective_from  DATE NOT NULL,
  effective_to    DATE NULL,                     -- NULL = current
  created_at      DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY ix_ownership_unit (unit_id, effective_to),
  KEY ix_ownership_org (organization_id),
  CONSTRAINT fk_ownership_party FOREIGN KEY (owner_party_id)
      REFERENCES occupancy_party (id)
) ENGINE=InnoDB;

CREATE TABLE occupancy_tenancy (
  id                CHAR(36) NOT NULL DEFAULT (UUID()),
  organization_id   CHAR(36) NOT NULL,
  unit_id           CHAR(36) NOT NULL,           -- xref: property_unit
  resident_party_id CHAR(36) NOT NULL,
  resident_role     ENUM('primary','co_resident') NOT NULL DEFAULT 'primary',
  effective_from    DATE NOT NULL,
  effective_to      DATE NULL,                   -- NULL = current
  created_at        DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY ix_tenancy_unit (unit_id, effective_to),
  KEY ix_tenancy_org (organization_id),
  CONSTRAINT fk_tenancy_party FOREIGN KEY (resident_party_id)
      REFERENCES occupancy_party (id)
) ENGINE=InnoDB;

-- =====================================================================
-- MODULE: onboarding  (Property Onboarding & Approval)
-- =====================================================================

CREATE TABLE onboarding_property_application (
  id                      CHAR(36) NOT NULL DEFAULT (UUID()),
  organization_id         CHAR(36) NOT NULL,
  submitted_property_name VARCHAR(200) NULL,
  property_type           ENUM('house','single_building','complex') NULL,
  address_line            VARCHAR(255) NULL,
  city                    VARCHAR(120) NULL,
  region                  VARCHAR(120) NULL,
  postal_code             VARCHAR(20)  NULL,
  country                 VARCHAR(80)  NULL,
  status                  ENUM('draft','submitted','under_review','more_info',
                               'approved','rejected','withdrawn') NOT NULL DEFAULT 'draft',
  created_property_id     CHAR(36) NULL,          -- xref: property_property (set on activation)
  submitted_by            CHAR(36) NULL,          -- xref: identity_app_user
  submitted_at            DATETIME(6) NULL,
  created_at              DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at              DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY ix_app_org (organization_id, status)
) ENGINE=InnoDB;

CREATE TABLE onboarding_application_document (
  id             CHAR(36) NOT NULL DEFAULT (UUID()),
  application_id CHAR(36) NOT NULL,
  file_ref       VARCHAR(500) NOT NULL,
  document_type  VARCHAR(100) NULL,
  uploaded_at    DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY ix_appdoc_app (application_id),
  CONSTRAINT fk_appdoc_app FOREIGN KEY (application_id)
      REFERENCES onboarding_property_application (id)
) ENGINE=InnoDB;

CREATE TABLE onboarding_approval_decision (
  id             CHAR(36) NOT NULL DEFAULT (UUID()),
  application_id CHAR(36) NOT NULL,
  outcome        ENUM('approved','rejected','more_info') NOT NULL,
  reason         VARCHAR(1000) NULL,
  decided_by     CHAR(36) NULL,                  -- xref: identity_app_user
  decided_at     DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY ix_decision_app (application_id),
  CONSTRAINT fk_decision_app FOREIGN KEY (application_id)
      REFERENCES onboarding_property_application (id)
) ENGINE=InnoDB;

CREATE TABLE onboarding_duplicate_match (
  id                  CHAR(36) NOT NULL DEFAULT (UUID()),
  application_id      CHAR(36) NOT NULL,
  matched_property_id CHAR(36) NOT NULL,          -- xref: property_property
  score               DECIMAL(5,4) NULL,
  PRIMARY KEY (id),
  KEY ix_dupe_app (application_id),
  CONSTRAINT fk_dupe_app FOREIGN KEY (application_id)
      REFERENCES onboarding_property_application (id)
) ENGINE=InnoDB;

-- =====================================================================
-- MODULE: maintenance  (Maintenance & Work Orders) -- CORE
-- =====================================================================

CREATE TABLE maintenance_category (          -- configurable lookup
  id              CHAR(36) NOT NULL DEFAULT (UUID()),
  organization_id CHAR(36) NULL,             -- NULL = platform default
  name            VARCHAR(80) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_category (organization_id, name)
) ENGINE=InnoDB;

CREATE TABLE maintenance_location (
  id             CHAR(36) NOT NULL DEFAULT (UUID()),
  location_type  ENUM('unit','building','common_area','property') NOT NULL,
  unit_id        CHAR(36) NULL,                  -- xref: property_unit
  building_id    CHAR(36) NULL,                  -- xref: property_building
  common_area_id CHAR(36) NULL,
  property_id    CHAR(36) NULL,                  -- xref: property_property
  PRIMARY KEY (id),
  KEY ix_loc_unit (unit_id),
  KEY ix_loc_property (property_id),
  CONSTRAINT ck_location_ref CHECK (
      (location_type = 'unit'        AND unit_id        IS NOT NULL) OR
      (location_type = 'building'    AND building_id    IS NOT NULL) OR
      (location_type = 'common_area' AND common_area_id IS NOT NULL) OR
      (location_type = 'property'    AND property_id    IS NOT NULL)
  )
) ENGINE=InnoDB;

CREATE TABLE maintenance_request (
  id                CHAR(36) NOT NULL DEFAULT (UUID()),
  organization_id   CHAR(36) NOT NULL,
  location_id       CHAR(36) NOT NULL,
  reporter_party_id CHAR(36) NULL,               -- xref: occupancy_party
  title             VARCHAR(200) NOT NULL,
  description       TEXT NULL,
  category_id       CHAR(36) NULL,
  priority          ENUM('low','normal','high','emergency') NOT NULL DEFAULT 'normal',
  urgency           ENUM('normal','urgent','emergency') NOT NULL DEFAULT 'normal',
  status            ENUM('reported','under_review','in_progress','on_hold',
                         'work_completed','verified','closed','reopened',
                         'escalated','rejected') NOT NULL DEFAULT 'reported',
  reference_no      VARCHAR(40) NOT NULL,
  reported_at       DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  closed_at         DATETIME(6) NULL,
  created_at        DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at        DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_request_ref (reference_no),
  KEY ix_request_org (organization_id, status),
  KEY ix_request_location (location_id),
  KEY ix_request_category (category_id),
  CONSTRAINT fk_request_location FOREIGN KEY (location_id)
      REFERENCES maintenance_location (id),
  CONSTRAINT fk_request_category FOREIGN KEY (category_id)
      REFERENCES maintenance_category (id)
) ENGINE=InnoDB;

CREATE TABLE maintenance_request_media (
  id          CHAR(36) NOT NULL DEFAULT (UUID()),
  request_id  CHAR(36) NOT NULL,
  file_ref    VARCHAR(500) NOT NULL,
  media_type  ENUM('photo','video') NOT NULL,
  uploaded_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY ix_media_request (request_id),
  CONSTRAINT fk_media_request FOREIGN KEY (request_id)
      REFERENCES maintenance_request (id)
) ENGINE=InnoDB;

CREATE TABLE maintenance_request_comment (
  id             CHAR(36) NOT NULL DEFAULT (UUID()),
  request_id     CHAR(36) NOT NULL,
  author_user_id CHAR(36) NULL,                  -- xref: identity_app_user
  body           TEXT NOT NULL,
  created_at     DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY ix_comment_request (request_id),
  CONSTRAINT fk_comment_request FOREIGN KEY (request_id)
      REFERENCES maintenance_request (id)
) ENGINE=InnoDB;

CREATE TABLE maintenance_request_timeline (
  id            CHAR(36) NOT NULL DEFAULT (UUID()),
  request_id    CHAR(36) NOT NULL,
  action        VARCHAR(80) NOT NULL,
  from_status   VARCHAR(40) NULL,
  to_status     VARCHAR(40) NULL,
  actor_user_id CHAR(36) NULL,                   -- xref: identity_app_user
  occurred_at   DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY ix_timeline_request (request_id, occurred_at),
  CONSTRAINT fk_timeline_request FOREIGN KEY (request_id)
      REFERENCES maintenance_request (id)
) ENGINE=InnoDB;

CREATE TABLE maintenance_work_order (
  id              CHAR(36) NOT NULL DEFAULT (UUID()),
  organization_id CHAR(36) NOT NULL,
  request_id      CHAR(36) NOT NULL,
  vendor_id       CHAR(36) NULL,                 -- xref: vendor_vendor (null until assigned)
  trade           ENUM('plumbing','electrical','carpentry','painting',
                       'ac','appliance','cleaning','general') NOT NULL,
  scope_of_work   TEXT NULL,
  status          ENUM('created','offered','accepted','rejected','in_progress',
                       'awaiting_parts','awaiting_approval','completed',
                       'verified','cancelled','reassigned') NOT NULL DEFAULT 'created',
  offered_at      DATETIME(6) NULL,
  responded_at    DATETIME(6) NULL,
  due_date        DATE NULL,
  created_at      DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at      DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY ix_wo_org (organization_id, status),
  KEY ix_wo_request (request_id),
  KEY ix_wo_vendor (vendor_id, status),
  CONSTRAINT fk_wo_request FOREIGN KEY (request_id)
      REFERENCES maintenance_request (id)
) ENGINE=InnoDB;

CREATE TABLE maintenance_work_order_progress (
  id            CHAR(36) NOT NULL DEFAULT (UUID()),
  work_order_id CHAR(36) NOT NULL,
  status_note   VARCHAR(255) NOT NULL,
  recorded_by   CHAR(36) NULL,                   -- xref: identity_app_user / technician
  recorded_at   DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY ix_progress_wo (work_order_id),
  CONSTRAINT fk_progress_wo FOREIGN KEY (work_order_id)
      REFERENCES maintenance_work_order (id)
) ENGINE=InnoDB;

CREATE TABLE maintenance_work_evidence (
  id            CHAR(36) NOT NULL DEFAULT (UUID()),
  work_order_id CHAR(36) NOT NULL,
  file_ref      VARCHAR(500) NOT NULL,
  note          TEXT NULL,
  uploaded_at   DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY ix_evidence_wo (work_order_id),
  CONSTRAINT fk_evidence_wo FOREIGN KEY (work_order_id)
      REFERENCES maintenance_work_order (id)
) ENGINE=InnoDB;

-- =====================================================================
-- MODULE: vendor  (Vendor Management)
-- =====================================================================

CREATE TABLE vendor_vendor (
  id              CHAR(36) NOT NULL DEFAULT (UUID()),
  organization_id CHAR(36) NOT NULL,             -- xref: identity_organization
  name            VARCHAR(200) NOT NULL,
  vendor_type     ENUM('company','independent') NOT NULL DEFAULT 'company',
  contact_email   VARCHAR(255) NULL,
  contact_phone   VARCHAR(40)  NULL,
  status          ENUM('draft','submitted','pending_verification','approved',
                       'active','rejected','suspended','inactive') NOT NULL DEFAULT 'draft',
  rating          DECIMAL(3,2) NULL,
  created_at      DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at      DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY ix_vendor_org (organization_id, status)
) ENGINE=InnoDB;

CREATE TABLE vendor_technician (
  id         CHAR(36) NOT NULL DEFAULT (UUID()),
  vendor_id  CHAR(36) NOT NULL,
  full_name  VARCHAR(200) NOT NULL,
  phone      VARCHAR(40) NULL,
  user_id    CHAR(36) NULL,                      -- xref: identity_app_user
  status     ENUM('active','inactive') NOT NULL DEFAULT 'active',
  PRIMARY KEY (id),
  KEY ix_tech_vendor (vendor_id),
  CONSTRAINT fk_tech_vendor FOREIGN KEY (vendor_id)
      REFERENCES vendor_vendor (id)
) ENGINE=InnoDB;

CREATE TABLE vendor_service_category (
  id        CHAR(36) NOT NULL DEFAULT (UUID()),
  vendor_id CHAR(36) NOT NULL,
  category  ENUM('plumbing','electrical','carpentry','painting',
                 'ac','appliance','cleaning','general') NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_vendor_category (vendor_id, category),
  CONSTRAINT fk_vsc_vendor FOREIGN KEY (vendor_id)
      REFERENCES vendor_vendor (id)
) ENGINE=InnoDB;

CREATE TABLE vendor_document (
  id            CHAR(36) NOT NULL DEFAULT (UUID()),
  vendor_id     CHAR(36) NOT NULL,
  file_ref      VARCHAR(500) NOT NULL,
  document_type VARCHAR(100) NULL,
  uploaded_at   DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY ix_vendordoc_vendor (vendor_id),
  CONSTRAINT fk_vendordoc_vendor FOREIGN KEY (vendor_id)
      REFERENCES vendor_vendor (id)
) ENGINE=InnoDB;

CREATE TABLE vendor_performance (
  vendor_id            CHAR(36) NOT NULL,
  acceptance_rate      DECIMAL(5,4) NULL,
  avg_completion_hours DECIMAL(8,2) NULL,
  repeat_repair_rate   DECIMAL(5,4) NULL,
  jobs_completed       INT NOT NULL DEFAULT 0,
  updated_at           DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (vendor_id),
  CONSTRAINT fk_perf_vendor FOREIGN KEY (vendor_id)
      REFERENCES vendor_vendor (id)
) ENGINE=InnoDB;

-- =====================================================================
-- MODULE: billing  (Billing & Expenses)
-- =====================================================================

CREATE TABLE billing_quotation (
  id              CHAR(36) NOT NULL DEFAULT (UUID()),
  organization_id CHAR(36) NOT NULL,
  work_order_id   CHAR(36) NOT NULL,             -- xref: maintenance_work_order
  amount          DECIMAL(14,2) NOT NULL,
  currency        CHAR(3) NOT NULL DEFAULT 'INR',
  status          ENUM('submitted','approved','rejected','escalated') NOT NULL DEFAULT 'submitted',
  approved_by     CHAR(36) NULL,                 -- xref: identity_app_user
  created_at      DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY ix_quote_org (organization_id),
  KEY ix_quote_wo (work_order_id)
) ENGINE=InnoDB;

CREATE TABLE billing_work_authorization (
  id                 CHAR(36) NOT NULL DEFAULT (UUID()),
  organization_id    CHAR(36) NOT NULL,
  work_order_id      CHAR(36) NOT NULL,          -- xref: maintenance_work_order
  authorization_type ENUM('normal','emergency') NOT NULL DEFAULT 'normal',
  cap_amount         DECIMAL(14,2) NULL,
  reason             VARCHAR(1000) NULL,
  authorized_by      CHAR(36) NULL,              -- xref: identity_app_user
  post_hoc_approved_by CHAR(36) NULL,            -- xref: identity_app_user
  authorized_at      DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY ix_auth_org (organization_id),
  KEY ix_auth_wo (work_order_id)
) ENGINE=InnoDB;

CREATE TABLE billing_invoice (
  id              CHAR(36) NOT NULL DEFAULT (UUID()),
  organization_id CHAR(36) NOT NULL,
  work_order_id   CHAR(36) NOT NULL,             -- xref: maintenance_work_order
  amount          DECIMAL(14,2) NOT NULL,
  currency        CHAR(3) NOT NULL DEFAULT 'INR',
  status          ENUM('submitted','verified','approved','rejected') NOT NULL DEFAULT 'submitted',
  submitted_by    CHAR(36) NULL,                 -- xref: identity_app_user (vendor)
  verified_by     CHAR(36) NULL,                 -- xref: identity_app_user
  created_at      DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY ix_invoice_org (organization_id),
  KEY ix_invoice_wo (work_order_id)
) ENGINE=InnoDB;

CREATE TABLE billing_payment_record (
  id             CHAR(36) NOT NULL DEFAULT (UUID()),
  invoice_id     CHAR(36) NOT NULL,
  payment_status ENUM('unpaid','part_paid','paid') NOT NULL DEFAULT 'unpaid',
  paid_amount    DECIMAL(14,2) NOT NULL DEFAULT 0,
  recorded_by    CHAR(36) NULL,                  -- xref: identity_app_user
  recorded_at    DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY ix_payment_invoice (invoice_id),
  CONSTRAINT fk_payment_invoice FOREIGN KEY (invoice_id)
      REFERENCES billing_invoice (id)
) ENGINE=InnoDB;

CREATE TABLE billing_expense_record (
  id              CHAR(36) NOT NULL DEFAULT (UUID()),
  organization_id CHAR(36) NOT NULL,
  request_id      CHAR(36) NOT NULL,             -- xref: maintenance_request
  work_order_id   CHAR(36) NULL,                 -- xref: maintenance_work_order
  amount          DECIMAL(14,2) NOT NULL,
  currency        CHAR(3) NOT NULL DEFAULT 'INR',
  cost_category   VARCHAR(80) NULL,
  payer_type      ENUM('owner','tenant','management_org','association') NOT NULL,
  payer_party_id  CHAR(36) NULL,                 -- xref: occupancy_party
  recorded_by     CHAR(36) NULL,                 -- xref: identity_app_user
  recorded_at     DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY ix_expense_org (organization_id),
  KEY ix_expense_request (request_id)
) ENGINE=InnoDB;

-- =====================================================================
-- MODULE: notif  (Notifications)
-- =====================================================================

CREATE TABLE notif_notification_preference (
  id                CHAR(36) NOT NULL DEFAULT (UUID()),
  user_id           CHAR(36) NOT NULL,           -- xref: identity_app_user
  channel           ENUM('push','email','in_app') NOT NULL,
  notification_type VARCHAR(80) NULL,
  enabled           TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  KEY ix_pref_user (user_id)
) ENGINE=InnoDB;

CREATE TABLE notif_notification (
  id                CHAR(36) NOT NULL DEFAULT (UUID()),
  organization_id   CHAR(36) NOT NULL,
  recipient_user_id CHAR(36) NOT NULL,           -- xref: identity_app_user
  type              VARCHAR(80) NOT NULL,
  subject_ref       CHAR(36) NULL,               -- xref: request / work order
  channel           ENUM('push','email','in_app') NOT NULL,
  status            ENUM('queued','sent','read','failed') NOT NULL DEFAULT 'queued',
  created_at        DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  sent_at           DATETIME(6) NULL,
  PRIMARY KEY (id),
  KEY ix_notif_recipient (recipient_user_id, status),
  KEY ix_notif_org (organization_id)
) ENGINE=InnoDB;

-- =====================================================================
-- MODULE: ai  (AI Advisory)
-- =====================================================================

CREATE TABLE ai_suggestion (
  id              CHAR(36) NOT NULL DEFAULT (UUID()),
  organization_id CHAR(36) NOT NULL,
  subject_type    ENUM('request','work_order') NOT NULL,
  subject_id      CHAR(36) NOT NULL,             -- xref: request / work order
  suggestion_type ENUM('category','priority','duplicate','vendor',
                       'cost_estimate','summary') NOT NULL,
  suggestion      JSON NULL,
  user_decision   ENUM('accepted','edited','ignored','pending') NOT NULL DEFAULT 'pending',
  created_at      DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY ix_ai_subject (subject_type, subject_id),
  KEY ix_ai_org (organization_id)
) ENGINE=InnoDB;

-- =====================================================================
-- MODULE: shared  (Outbox & Audit)
-- =====================================================================

CREATE TABLE shared_outbox_event (
  id             CHAR(36) NOT NULL DEFAULT (UUID()),
  organization_id CHAR(36) NULL,
  event_type     VARCHAR(100) NOT NULL,
  aggregate_type VARCHAR(80)  NOT NULL,
  aggregate_id   CHAR(36) NOT NULL,
  payload        JSON NOT NULL,
  occurred_at    DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  dispatched_at  DATETIME(6) NULL,
  attempts       INT NOT NULL DEFAULT 0,
  status         ENUM('pending','dispatched','failed') NOT NULL DEFAULT 'pending',
  PRIMARY KEY (id),
  KEY ix_outbox_dispatch (status, occurred_at)
) ENGINE=InnoDB;

CREATE TABLE shared_audit_log (
  id              CHAR(36) NOT NULL DEFAULT (UUID()),
  organization_id CHAR(36) NULL,
  actor_user_id   CHAR(36) NULL,
  action          VARCHAR(100) NOT NULL,
  entity_type     VARCHAR(80)  NOT NULL,
  entity_id       CHAR(36) NOT NULL,
  detail          JSON NULL,
  occurred_at     DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY ix_audit_entity (entity_type, entity_id),
  KEY ix_audit_org (organization_id, occurred_at)
) ENGINE=InnoDB;

SET FOREIGN_KEY_CHECKS = 1;

-- =====================================================================
-- End of schema
-- =====================================================================
