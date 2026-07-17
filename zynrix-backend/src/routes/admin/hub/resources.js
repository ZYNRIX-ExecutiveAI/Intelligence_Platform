// src/routes/admin/hub/resources.js
const express = require("express");
const fs = require("fs");
const path = require("path");
const { db, uuid, nowISO } = require("../../../db");
const { requirePermission, requireAuth } = require("../../../auth");
const { logAudit, resourceRowToJSON } = require("../../../utils");
const { uploadResource, uploadCover, RESOURCES_DIR, extOf } = require("../../../middleware/upload");
const bus = require("../../../eventBus");

const router = express.Router();

function getSettings(){ return db.prepare("SELECT * FROM hub_settings WHERE id = 1").get(); }

function withExtras(row){
  const json = resourceRowToJSON(row);
  const collectionIds = db.prepare("SELECT collection_id FROM hub_collection_resources WHERE resource_id = ?").all(row.id).map(r => r.collection_id);
  const versions = db.prepare("SELECT * FROM hub_resource_versions WHERE resource_id = ? ORDER BY uploaded_at DESC").all(row.id).map(v => ({
    versionId: v.id, versionNumber: v.version_number, filename: v.filename, fileSize: v.file_size, mimeType: v.mime_type,
    releaseNotes: v.release_notes, uploadedBy: v.uploaded_by, uploadedAt: v.uploaded_at, isCurrent: !!v.is_current, downloadCount: v.download_count
  }));
  json.collectionIds = collectionIds;
  json.versions = versions;
  return json;
}

router.get("/", (req, res) => {
  const rows = db.prepare("SELECT * FROM hub_resources ORDER BY updated_at DESC").all();
  res.json(rows.map(withExtras));
});

router.get("/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM hub_resources WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "Resource not found." });
  db.prepare("UPDATE hub_resources SET view_count = view_count + 1 WHERE id = ?").run(row.id);
  db.prepare("INSERT INTO hub_events (id,type,resource_id,ts) VALUES (?,?,?,?)").run(uuid(), "view", row.id, nowISO());
  res.json(withExtras(row));
});

// --- create (upload wizard) ---
router.post("/", requirePermission("upload"), uploadResource.single("file"), (req, res) => {
  const settings = getSettings();
  const f = req.file;
  const body = req.body || {};
  if (!f) return res.status(400).json({ error: "A file is required." });

  const maxBytes = (settings.max_file_size_mb || 25) * 1024 * 1024;
  if (f.size > maxBytes) {
    fs.unlink(f.path, () => {});
    return res.status(400).json({ error: "File exceeds the " + settings.max_file_size_mb + " MB limit." });
  }

  const id = uuid();
  const now = nowISO();
  const tags = JSON.stringify((body.tags ? String(body.tags).split(",").map(s => s.trim()).filter(Boolean) : []));

  db.prepare(`INSERT INTO hub_resources (
    id, title, subtitle, short_description, full_description, resource_type, category_id, version, language, author,
    release_notes, intended_audience, estimated_usage_time, external_url, support_contact, copyright_notice, tags, journey_stage,
    access_level, requires_login, requires_email_capture, requires_org_details, is_free, is_gated,
    is_featured, is_recommended, is_pinned, is_new, new_badge_expires_at, is_updated,
    status, published_at, scheduled_publish_at, owner, created_by, updated_by, created_at, updated_at,
    download_count, view_count, sort_order, current_file_path, current_file_name, current_file_ext, current_file_mime, current_file_size
  ) VALUES (?,?,?,?,?,?,?,?,?,?, ?,?,?,?,?,?,?,?, ?,?,?,?,?,?, ?,?,?,?,?,?, ?,?,?,?,?,?,?,?, ?,?,?,?,?,?,?,?)`).run(
    id, body.title || "Untitled resource", body.subtitle || "", body.shortDescription || "", body.fullDescription || "",
    body.resourceType || "Other", body.categoryId || null, body.version || "1.0", body.language || "English", body.author || "",
    body.releaseNotes || "", body.intendedAudience || "", body.estimatedUsageTime || "", body.externalUrl || "", body.supportContact || "",
    body.copyrightNotice || "", tags, body.journeyStage || "",
    body.accessLevel || "registered_user", body.requiresLogin === "false" ? 0 : 1, body.requiresEmailCapture === "true" ? 1 : 0,
    body.requiresOrgDetails === "true" ? 1 : 0, body.isFree === "false" ? 0 : 1, body.isGated === "true" ? 1 : 0,
    body.isFeatured === "true" ? 1 : 0, body.isRecommended === "true" ? 1 : 0, body.isPinned === "true" ? 1 : 0,
    body.isNew === "false" ? 0 : 1, body.newBadgeExpiresAt || null, 0,
    body.status || "draft", body.status === "published" ? now : null, body.scheduledPublishAt || null,
    req.admin.name, req.admin.name, req.admin.name, now, now,
    0, 0, 0, f.filename, f.originalname, extOf(f.originalname), f.mimetype, f.size
  );

  db.prepare(`INSERT INTO hub_resource_versions (id, resource_id, version_number, file_path, filename, file_size, mime_type, release_notes, uploaded_by, uploaded_at, is_current, download_count)
              VALUES (?,?,?,?,?,?,?,?,?,?,1,0)`)
    .run(uuid(), id, body.version || "1.0", f.filename, f.originalname, f.size, f.mimetype, body.releaseNotes || "Initial release.", req.admin.name, now);

  if (body.collectionIds) {
    let ids = [];
    try { ids = JSON.parse(body.collectionIds); } catch(e) { ids = String(body.collectionIds).split(",").map(s=>s.trim()).filter(Boolean); }
    const insertLink = db.prepare("INSERT OR IGNORE INTO hub_collection_resources (collection_id, resource_id, sort_order) VALUES (?,?,0)");
    ids.forEach(cid => insertLink.run(cid, id));
  }

  logAudit({ adminId: req.admin.id, adminName: req.admin.name, action: "uploaded", module: "executive_hub", targetType: "resource", targetLabel: body.title, targetId: id, details: "Status: " + (body.status || "draft") });
  bus.emit("event", { type: "hub_change", ts: now });
  res.status(201).json({ id });
});

router.patch("/:id", requirePermission("edit"), (req, res) => {
  const row = db.prepare("SELECT * FROM hub_resources WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "Resource not found." });
  const b = req.body || {};
  const fields = {
    title: b.title, subtitle: b.subtitle, short_description: b.shortDescription, full_description: b.fullDescription,
    resource_type: b.resourceType, category_id: b.categoryId, version: b.version, language: b.language, author: b.author,
    tags: b.tags ? JSON.stringify(b.tags) : undefined, access_level: b.accessLevel,
    requires_login: b.requiresLogin != null ? (b.requiresLogin?1:0) : undefined,
    requires_email_capture: b.requiresEmailCapture != null ? (b.requiresEmailCapture?1:0) : undefined,
    requires_org_details: b.requiresOrgDetails != null ? (b.requiresOrgDetails?1:0) : undefined,
    is_free: b.isFree != null ? (b.isFree?1:0) : undefined,
    is_gated: b.isGated != null ? (b.isGated?1:0) : undefined,
    is_featured: b.isFeatured != null ? (b.isFeatured?1:0) : undefined,
    is_recommended: b.isRecommended != null ? (b.isRecommended?1:0) : undefined,
    is_pinned: b.isPinned != null ? (b.isPinned?1:0) : undefined,
    is_new: b.isNew != null ? (b.isNew?1:0) : undefined,
    new_badge_expires_at: b.newBadgeExpiresAt,
    is_updated: b.isUpdated != null ? (b.isUpdated?1:0) : undefined,
    owner: b.owner, review_date: b.reviewDate, publication_notes: b.publicationNotes,
    support_contact: b.supportContact, external_url: b.externalUrl, copyright_notice: b.copyrightNotice
  };
  const setParts = []; const values = [];
  Object.keys(fields).forEach(k => { if (fields[k] !== undefined) { setParts.push(k + " = ?"); values.push(fields[k]); } });
  setParts.push("updated_at = ?"); values.push(nowISO());
  setParts.push("updated_by = ?"); values.push(req.admin.name);
  values.push(row.id);
  db.prepare(`UPDATE hub_resources SET ${setParts.join(", ")} WHERE id = ?`).run(...values);

  if (Array.isArray(b.collectionIds)) {
    db.prepare("DELETE FROM hub_collection_resources WHERE resource_id = ?").run(row.id);
    const insertLink = db.prepare("INSERT OR IGNORE INTO hub_collection_resources (collection_id, resource_id, sort_order) VALUES (?,?,0)");
    b.collectionIds.forEach(cid => insertLink.run(cid, row.id));
  }

  logAudit({ adminId: req.admin.id, adminName: req.admin.name, action: "edited metadata for", module: "executive_hub", targetType: "resource", targetLabel: b.title || row.title, targetId: row.id });
  bus.emit("event", { type: "hub_change", ts: nowISO() });
  res.json({ ok: true });
});

router.post("/:id/cover", requirePermission("edit"), uploadCover.single("cover"), (req, res) => {
  const row = db.prepare("SELECT * FROM hub_resources WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "Resource not found." });
  if (!req.file) return res.status(400).json({ error: "No image received." });
  db.prepare("UPDATE hub_resources SET cover_image_path = ?, updated_at = ? WHERE id = ?").run(req.file.filename, nowISO(), row.id);
  res.json({ ok: true, coverImageUrl: "/files/covers/" + req.file.filename });
});

router.post("/:id/replace-file", requirePermission("upload"), uploadResource.single("file"), (req, res) => {
  const row = db.prepare("SELECT * FROM hub_resources WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "Resource not found." });
  const f = req.file;
  if (!f) return res.status(400).json({ error: "A file is required." });
  const settings = getSettings();
  const maxBytes = (settings.max_file_size_mb || 25) * 1024 * 1024;
  if (f.size > maxBytes) { fs.unlink(f.path, () => {}); return res.status(400).json({ error: "File exceeds the " + settings.max_file_size_mb + " MB limit." }); }

  const nextVersion = (parseFloat(row.version || "1.0") + 0.1).toFixed(1);
  const now = nowISO();
  db.prepare("UPDATE hub_resource_versions SET is_current = 0 WHERE resource_id = ?").run(row.id);
  db.prepare(`INSERT INTO hub_resource_versions (id, resource_id, version_number, file_path, filename, file_size, mime_type, release_notes, uploaded_by, uploaded_at, is_current, download_count)
              VALUES (?,?,?,?,?,?,?,?,?,?,1,0)`)
    .run(uuid(), row.id, nextVersion, f.filename, f.originalname, f.size, f.mimetype, req.body.releaseNotes || "", req.admin.name, now);
  db.prepare(`UPDATE hub_resources SET version=?, current_file_path=?, current_file_name=?, current_file_ext=?, current_file_mime=?, current_file_size=?, is_updated=1, updated_at=?, updated_by=? WHERE id=?`)
    .run(nextVersion, f.filename, f.originalname, extOf(f.originalname), f.mimetype, f.size, now, req.admin.name, row.id);

  logAudit({ adminId: req.admin.id, adminName: req.admin.name, action: "replaced the file for", module: "executive_hub", targetType: "resource", targetLabel: row.title, targetId: row.id, details: "New version " + nextVersion });
  bus.emit("event", { type: "hub_change", ts: now });
  res.json({ ok: true, version: nextVersion });
});

router.post("/:id/versions/:versionId/restore", requirePermission("edit"), (req, res) => {
  const row = db.prepare("SELECT * FROM hub_resources WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "Resource not found." });
  const v = db.prepare("SELECT * FROM hub_resource_versions WHERE id = ? AND resource_id = ?").get(req.params.versionId, row.id);
  if (!v) return res.status(404).json({ error: "Version not found." });
  db.prepare("UPDATE hub_resource_versions SET is_current = 0 WHERE resource_id = ?").run(row.id);
  db.prepare("UPDATE hub_resource_versions SET is_current = 1 WHERE id = ?").run(v.id);
  db.prepare("UPDATE hub_resources SET version=?, current_file_path=?, current_file_name=?, current_file_ext=?, current_file_mime=?, current_file_size=?, updated_at=? WHERE id=?")
    .run(v.version_number, v.file_path, v.filename, extOf(v.filename), v.mime_type, v.file_size, nowISO(), row.id);
  logAudit({ adminId: req.admin.id, adminName: req.admin.name, action: "restored version for", module: "executive_hub", targetType: "resource", targetLabel: row.title, targetId: row.id, details: "Restored v" + v.version_number });
  res.json({ ok: true });
});

function transitionRoute(actionName, permission, statusValue, extra){
  router.post("/:id/" + actionName, requirePermission(permission), (req, res) => {
    const row = db.prepare("SELECT * FROM hub_resources WHERE id = ?").get(req.params.id);
    if (!row) return res.status(404).json({ error: "Resource not found." });
    const now = nowISO();
    const fields = Object.assign({ status: statusValue, updated_at: now }, typeof extra === "function" ? extra(req, row, now) : {});
    const setParts = Object.keys(fields).map(k => k + " = ?");
    const values = Object.keys(fields).map(k => fields[k]);
    values.push(row.id);
    db.prepare(`UPDATE hub_resources SET ${setParts.join(", ")} WHERE id = ?`).run(...values);
    logAudit({ adminId: req.admin.id, adminName: req.admin.name, action: actionName === "publish" ? "published" : actionName, module: "executive_hub", targetType: "resource", targetLabel: row.title, targetId: row.id });
    bus.emit("event", { type: "hub_change", ts: now });
    res.json({ ok: true });
  });
}
transitionRoute("publish", "publish", "published", () => ({ published_at: nowISO(), scheduled_publish_at: null }));
transitionRoute("unpublish", "unpublish", "unpublished");
transitionRoute("archive", "archive", "archived", () => ({ archived_at: nowISO() }));
transitionRoute("submit-for-review", "edit", "in_review");
transitionRoute("return-to-draft", "edit", "draft");

router.post("/:id/schedule", requirePermission("schedule"), (req, res) => {
  const row = db.prepare("SELECT * FROM hub_resources WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "Resource not found." });
  const { scheduledPublishAt } = req.body || {};
  if (!scheduledPublishAt) return res.status(400).json({ error: "scheduledPublishAt is required." });
  db.prepare("UPDATE hub_resources SET status='scheduled', scheduled_publish_at=?, updated_at=? WHERE id=?").run(scheduledPublishAt, nowISO(), row.id);
  logAudit({ adminId: req.admin.id, adminName: req.admin.name, action: "scheduled", module: "executive_hub", targetType: "resource", targetLabel: row.title, targetId: row.id, details: "For " + scheduledPublishAt });
  res.json({ ok: true });
});

router.delete("/:id", requirePermission("delete"), (req, res) => {
  const row = db.prepare("SELECT * FROM hub_resources WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "Resource not found." });
  const versions = db.prepare("SELECT file_path FROM hub_resource_versions WHERE resource_id = ?").all(row.id);
  db.prepare("DELETE FROM hub_resources WHERE id = ?").run(row.id); // cascades versions + collection links
  versions.forEach(v => { if (v.file_path) fs.unlink(path.join(RESOURCES_DIR, v.file_path), () => {}); });
  logAudit({ adminId: req.admin.id, adminName: req.admin.name, action: "deleted", module: "executive_hub", targetType: "resource", targetLabel: row.title, targetId: row.id, details: "Permanent delete" });
  bus.emit("event", { type: "hub_change", ts: nowISO() });
  res.json({ ok: true });
});

router.post("/:id/duplicate", requirePermission("create"), (req, res) => {
  const row = db.prepare("SELECT * FROM hub_resources WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "Resource not found." });
  const id = uuid();
  const now = nowISO();
  const copy = Object.assign({}, row, { id, title: row.title + " (Copy)", status: "draft", published_at: null, scheduled_publish_at: null, archived_at: null, download_count: 0, view_count: 0, is_featured: 0, is_pinned: 0, created_at: now, updated_at: now, created_by: req.admin.name, updated_by: req.admin.name });
  const cols = Object.keys(copy).filter(k => k !== "rowid");
  const placeholders = cols.map(() => "?").join(",");
  db.prepare(`INSERT INTO hub_resources (${cols.join(",")}) VALUES (${placeholders})`).run(...cols.map(c => copy[c]));
  logAudit({ adminId: req.admin.id, adminName: req.admin.name, action: "duplicated", module: "executive_hub", targetType: "resource", targetLabel: row.title, targetId: row.id, details: "Created \u201c" + copy.title + "\u201d" });
  bus.emit("event", { type: "hub_change", ts: now });
  res.status(201).json({ id });
});

router.get("/:id/download", requireAuth, (req, res) => {
  const row = db.prepare("SELECT * FROM hub_resources WHERE id = ?").get(req.params.id);
  if (!row || !row.current_file_path) return res.status(404).json({ error: "No file on this resource." });
  const filePath = path.join(RESOURCES_DIR, row.current_file_path);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: "File missing from storage." });
  db.prepare("UPDATE hub_resources SET download_count = download_count + 1 WHERE id = ?").run(row.id);
  db.prepare("INSERT INTO hub_events (id,type,resource_id,ts) VALUES (?,?,?,?)").run(uuid(), "download", row.id, nowISO());
  bus.emit("event", { type: "hub_change", ts: nowISO() });
  res.download(filePath, row.current_file_name);
});

router.post("/bulk", (req, res) => {
  const { ids, action, categoryId } = req.body || {};
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: "ids array is required." });
  const permMap = { publish: "publish", unpublish: "unpublish", archive: "archive", delete: "delete", category: "edit" };
  const { can } = require("../../../auth");
  if (!can(req.admin.role, permMap[action])) return res.status(403).json({ error: "Your role can't perform this action." });

  const now = nowISO();
  const placeholders = ids.map(() => "?").join(",");
  if (action === "publish") db.prepare(`UPDATE hub_resources SET status='published', published_at=COALESCE(published_at, ?), updated_at=? WHERE id IN (${placeholders})`).run(now, now, ...ids);
  else if (action === "unpublish") db.prepare(`UPDATE hub_resources SET status='unpublished', updated_at=? WHERE id IN (${placeholders})`).run(now, ...ids);
  else if (action === "archive") db.prepare(`UPDATE hub_resources SET status='archived', archived_at=?, updated_at=? WHERE id IN (${placeholders})`).run(now, now, ...ids);
  else if (action === "category") db.prepare(`UPDATE hub_resources SET category_id=?, updated_at=? WHERE id IN (${placeholders})`).run(categoryId, now, ...ids);
  else if (action === "delete") {
    const rows = db.prepare(`SELECT id FROM hub_resources WHERE id IN (${placeholders})`).all(...ids);
    db.prepare(`DELETE FROM hub_resources WHERE id IN (${placeholders})`).run(...ids);
  } else return res.status(400).json({ error: "Unknown action." });

  logAudit({ adminId: req.admin.id, adminName: req.admin.name, action: action, module: "executive_hub", targetType: "resource", targetLabel: ids.length + " resources", details: "Bulk action" });
  bus.emit("event", { type: "hub_change", ts: now });
  res.json({ ok: true, count: ids.length });
});

module.exports = router;
