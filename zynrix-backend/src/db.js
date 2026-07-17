// src/db.js
// SQLite database: schema creation + first-boot admin seeding.
// Uses a single file on disk so the whole dataset is one portable file.
// IMPORTANT: this file must live on a persistent volume/disk in production —
// see README.md "Hosting notes" before you deploy.

const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const { v4: uuid } = require("uuid");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, "zynrix.db");

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS admin_users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('super_admin','publisher','content_editor','analyst')),
  created_at TEXT NOT NULL,
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  session_id TEXT UNIQUE,
  name TEXT,
  email TEXT,
  organization TEXT,
  industry TEXT,
  country TEXT,
  job_title TEXT,
  company_size TEXT,
  assessment_purpose TEXT,
  registered_at TEXT NOT NULL,
  last_activity_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS assessment_attempts (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  dimension_scores TEXT,
  total_score INTEGER,
  tier TEXT,
  report_generated_at TEXT
);

CREATE TABLE IF NOT EXISTS visit_events (
  id TEXT PRIMARY KEY,
  ts TEXT NOT NULL,
  session_id TEXT NOT NULL,
  day TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reactions (
  id TEXT PRIMARY KEY,
  ts TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('up','down','rating')),
  rating INTEGER,
  comment TEXT,
  session_id TEXT
);

CREATE TABLE IF NOT EXISTS hub_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hub_resources (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  subtitle TEXT,
  short_description TEXT,
  full_description TEXT,
  resource_type TEXT,
  category_id TEXT REFERENCES hub_categories(id) ON DELETE SET NULL,
  version TEXT,
  language TEXT,
  author TEXT,
  release_notes TEXT,
  intended_audience TEXT,
  estimated_usage_time TEXT,
  external_url TEXT,
  support_contact TEXT,
  copyright_notice TEXT,
  tags TEXT,
  journey_stage TEXT,
  access_level TEXT,
  requires_login INTEGER DEFAULT 1,
  requires_email_capture INTEGER DEFAULT 0,
  requires_org_details INTEGER DEFAULT 0,
  is_free INTEGER DEFAULT 1,
  is_gated INTEGER DEFAULT 0,
  is_featured INTEGER DEFAULT 0,
  is_recommended INTEGER DEFAULT 0,
  is_pinned INTEGER DEFAULT 0,
  is_new INTEGER DEFAULT 0,
  new_badge_expires_at TEXT,
  is_updated INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',
  published_at TEXT,
  scheduled_publish_at TEXT,
  expires_at TEXT,
  review_date TEXT,
  owner TEXT,
  approval_status TEXT,
  approved_by TEXT,
  publication_notes TEXT,
  created_by TEXT,
  updated_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  download_count INTEGER DEFAULT 0,
  view_count INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  cover_image_path TEXT,
  current_file_path TEXT,
  current_file_name TEXT,
  current_file_ext TEXT,
  current_file_mime TEXT,
  current_file_size INTEGER
);

CREATE TABLE IF NOT EXISTS hub_resource_versions (
  id TEXT PRIMARY KEY,
  resource_id TEXT NOT NULL REFERENCES hub_resources(id) ON DELETE CASCADE,
  version_number TEXT,
  file_path TEXT,
  filename TEXT,
  file_size INTEGER,
  mime_type TEXT,
  release_notes TEXT,
  uploaded_by TEXT,
  uploaded_at TEXT,
  is_current INTEGER DEFAULT 0,
  download_count INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS hub_collections (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT,
  description TEXT,
  cover_image_path TEXT,
  version TEXT,
  status TEXT DEFAULT 'draft',
  access_level TEXT,
  published_at TEXT,
  updated_at TEXT,
  owner TEXT,
  featured INTEGER DEFAULT 0,
  is_new INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  start_here_resource_id TEXT
);

CREATE TABLE IF NOT EXISTS hub_collection_resources (
  collection_id TEXT NOT NULL REFERENCES hub_collections(id) ON DELETE CASCADE,
  resource_id TEXT NOT NULL REFERENCES hub_resources(id) ON DELETE CASCADE,
  sort_order INTEGER DEFAULT 0,
  PRIMARY KEY (collection_id, resource_id)
);

CREATE TABLE IF NOT EXISTS hub_notifications (
  id TEXT PRIMARY KEY,
  title TEXT,
  message TEXT,
  target_audience TEXT,
  channels TEXT,
  start_date TEXT,
  end_date TEXT,
  priority TEXT,
  dismissible INTEGER DEFAULT 1,
  cta_label TEXT,
  resource_id TEXT,
  collection_id TEXT,
  created_at TEXT,
  created_by TEXT
);

CREATE TABLE IF NOT EXISTS hub_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK(type IN ('view','download')),
  resource_id TEXT NOT NULL,
  ts TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hub_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  max_file_size_mb INTEGER DEFAULT 25,
  allowed_extensions TEXT,
  default_new_badge_days INTEGER DEFAULT 14,
  default_access_level TEXT DEFAULT 'registered_user',
  default_workflow TEXT DEFAULT 'draft',
  download_url_expiry_minutes INTEGER DEFAULT 30,
  public_downloads_enabled INTEGER DEFAULT 1,
  email_notifications_enabled INTEGER DEFAULT 0,
  auto_zip_enabled INTEGER DEFAULT 1,
  review_frequency_days INTEGER DEFAULT 90,
  default_sort_order TEXT DEFAULT 'newest',
  resources_per_page INTEGER DEFAULT 10,
  analytics_retention_days INTEGER DEFAULT 365,
  audit_retention_days INTEGER DEFAULT 365,
  support_email TEXT
);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  ts TEXT NOT NULL,
  admin_id TEXT,
  admin_name TEXT,
  action TEXT,
  module TEXT,
  target_type TEXT,
  target_label TEXT,
  target_id TEXT,
  details TEXT
);

CREATE INDEX IF NOT EXISTS idx_visit_events_day ON visit_events(day);
CREATE INDEX IF NOT EXISTS idx_hub_events_resource ON hub_events(resource_id);
CREATE INDEX IF NOT EXISTS idx_hub_events_ts ON hub_events(ts);
CREATE INDEX IF NOT EXISTS idx_attempts_client ON assessment_attempts(client_id);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(ts);
`);

// --- first-boot seeding: default categories, settings, and the first admin ---
function nowISO(){ return new Date().toISOString(); }

const DEFAULT_CATEGORIES = [
  ["cat_foundation", "Foundation Edition", "foundation-edition", "Resources bundled with or extending the Foundation Edition experience."],
  ["cat_assessments", "Executive Assessments", "executive-assessments", "Assessment instruments and scoring companions."],
  ["cat_guides", "Executive Guides", "executive-guides", "Long-form guidance for executive audiences."],
  ["cat_prompts", "Prompt Collections", "prompt-collections", "Curated prompt libraries for executive use cases."],
  ["cat_playbooks", "Playbooks", "playbooks", "Step-by-step operating playbooks."],
  ["cat_frameworks", "Frameworks", "frameworks", "Decision and governance frameworks."],
  ["cat_templates", "Templates", "templates", "Reusable document and planning templates."],
  ["cat_quickref", "Quick References", "quick-references", "One-page references and cheat sheets."],
  ["cat_transformation", "Transformation Resources", "transformation-resources", "Materials supporting enterprise transformation programs."],
  ["cat_governance", "Governance Resources", "governance-resources", "Governance, risk and oversight materials."],
  ["cat_legal", "Legal & Trust", "legal-trust", "Legal, privacy and trust documentation."],
  ["cat_reports", "Reports", "reports", "Research and benchmark reports."],
  ["cat_new", "New Releases", "new-releases", "Recently released material across all categories."]
];

function seedIfEmpty(){
  const catCount = db.prepare("SELECT COUNT(*) AS c FROM hub_categories").get().c;
  if (catCount === 0){
    const insert = db.prepare("INSERT INTO hub_categories (id,name,slug,description,created_at) VALUES (?,?,?,?,?)");
    const tx = db.transaction((rows) => { rows.forEach(r => insert.run(r[0], r[1], r[2], r[3], nowISO())); });
    tx(DEFAULT_CATEGORIES);
  }

  const settingsCount = db.prepare("SELECT COUNT(*) AS c FROM hub_settings").get().c;
  if (settingsCount === 0){
    db.prepare(`INSERT INTO hub_settings (id, allowed_extensions, support_email) VALUES (1, ?, ?)`)
      .run(JSON.stringify(["pdf","zip","docx","xlsx","pptx","txt","csv","png","jpg","jpeg","webp"]), process.env.DEFAULT_SUPPORT_EMAIL || "hub-support@zynrix.example");
  }

  const adminCount = db.prepare("SELECT COUNT(*) AS c FROM admin_users").get().c;
  if (adminCount === 0){
    const email = process.env.FIRST_ADMIN_EMAIL || "admin@zynrix.example";
    const password = process.env.FIRST_ADMIN_PASSWORD || "changeme123";
    const hash = bcrypt.hashSync(password, 10);
    db.prepare("INSERT INTO admin_users (id,name,email,password_hash,role,created_at) VALUES (?,?,?,?,?,?)")
      .run(uuid(), process.env.FIRST_ADMIN_NAME || "Super Admin", email, hash, "super_admin", nowISO());
    console.log("\n=== First admin account created ===");
    console.log("Email:   " + email);
    console.log("Password:" + (process.env.FIRST_ADMIN_PASSWORD ? " (from FIRST_ADMIN_PASSWORD env var)" : " changeme123  <-- CHANGE THIS IMMEDIATELY"));
    console.log("====================================\n");
  }
}
seedIfEmpty();

module.exports = { db, uuid, nowISO };
