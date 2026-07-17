// src/routes/admin/hub/collections.js
const express = require("express");
const fs = require("fs");
const path = require("path");
const archiver = require("archiver");
const { db, uuid, nowISO } = require("../../../db");
const { requirePermission } = require("../../../auth");
const { logAudit } = require("../../../utils");
const { RESOURCES_DIR } = require("../../../middleware/upload");
const bus = require("../../../eventBus");

const router = express.Router();

function slugify(s){ return String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""); }

function withExtras(row){
  const resourceIds = db.prepare("SELECT resource_id FROM hub_collection_resources WHERE collection_id = ? ORDER BY sort_order ASC").all(row.id).map(r => r.resource_id);
  return {
    id: row.id, name: row.name, slug: row.slug, description: row.description,
    coverImage: row.cover_image_path ? ("/files/covers/" + row.cover_image_path) : null,
    version: row.version, status: row.status, accessLevel: row.access_level,
    publishedAt: row.published_at, updatedAt: row.updated_at, owner: row.owner,
    featured: !!row.featured, isNew: !!row.is_new, sortOrder: row.sort_order,
    startHereResourceId: row.start_here_resource_id, resourceIds
  };
}

router.get("/", (req, res) => {
  const rows = db.prepare("SELECT * FROM hub_collections ORDER BY sort_order ASC").all();
  res.json(rows.map(withExtras));
});

router.post("/", requirePermission("manage_collections"), (req, res) => {
  const b = req.body || {};
  if (!b.name || !b.name.trim()) return res.status(400).json({ error: "Collection name is required." });
  const id = uuid();
  const now = nowISO();
  db.prepare(`INSERT INTO hub_collections (id,name,slug,description,version,status,access_level,published_at,updated_at,owner,featured,is_new,sort_order,start_here_resource_id)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, b.name.trim(), slugify(b.name), b.description||"", b.version||"1.0", b.status||"draft", b.accessLevel||"registered_user",
         b.status === "published" ? now : null, now, req.admin.name, b.featured?1:0, b.isNew?1:0,
         db.prepare("SELECT COUNT(*) AS c FROM hub_collections").get().c, b.startHereResourceId || null);
  if (Array.isArray(b.resourceIds)) {
    const ins = db.prepare("INSERT INTO hub_collection_resources (collection_id, resource_id, sort_order) VALUES (?,?,?)");
    b.resourceIds.forEach((rid, i) => ins.run(id, rid, i));
  }
  logAudit({ adminId: req.admin.id, adminName: req.admin.name, action: "created", module: "executive_hub", targetType: "collection", targetLabel: b.name, targetId: id });
  bus.emit("event", { type: "hub_change", ts: now });
  res.status(201).json({ id });
});

router.patch("/:id", requirePermission("manage_collections"), (req, res) => {
  const row = db.prepare("SELECT * FROM hub_collections WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "Collection not found." });
  const b = req.body || {};
  const now = nowISO();
  db.prepare(`UPDATE hub_collections SET name=?, slug=?, description=?, version=?, status=?, access_level=?, published_at=?, updated_at=?, featured=?, is_new=?, start_here_resource_id=? WHERE id=?`)
    .run(b.name || row.name, slugify(b.name || row.name), b.description != null ? b.description : row.description,
         b.version || row.version, b.status || row.status, b.accessLevel || row.access_level,
         (b.status === "published" && !row.published_at) ? now : row.published_at, now,
         b.featured != null ? (b.featured?1:0) : row.featured, b.isNew != null ? (b.isNew?1:0) : row.is_new,
         b.startHereResourceId !== undefined ? b.startHereResourceId : row.start_here_resource_id, row.id);
  if (Array.isArray(b.resourceIds)) {
    db.prepare("DELETE FROM hub_collection_resources WHERE collection_id = ?").run(row.id);
    const ins = db.prepare("INSERT INTO hub_collection_resources (collection_id, resource_id, sort_order) VALUES (?,?,?)");
    b.resourceIds.forEach((rid, i) => ins.run(row.id, rid, i));
  }
  logAudit({ adminId: req.admin.id, adminName: req.admin.name, action: "edited", module: "executive_hub", targetType: "collection", targetLabel: b.name || row.name, targetId: row.id });
  bus.emit("event", { type: "hub_change", ts: now });
  res.json({ ok: true });
});

router.post("/:id/cover", requirePermission("manage_collections"), require("../../../middleware/upload").uploadCover.single("cover"), (req, res) => {
  const row = db.prepare("SELECT * FROM hub_collections WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "Collection not found." });
  if (!req.file) return res.status(400).json({ error: "No image received." });
  db.prepare("UPDATE hub_collections SET cover_image_path = ?, updated_at = ? WHERE id = ?").run(req.file.filename, nowISO(), row.id);
  res.json({ ok: true, coverImage: "/files/covers/" + req.file.filename });
});

router.delete("/:id", requirePermission("manage_collections"), (req, res) => {
  const row = db.prepare("SELECT * FROM hub_collections WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "Collection not found." });
  db.prepare("DELETE FROM hub_collections WHERE id = ?").run(row.id);
  logAudit({ adminId: req.admin.id, adminName: req.admin.name, action: "deleted", module: "executive_hub", targetType: "collection", targetLabel: row.name, targetId: row.id });
  bus.emit("event", { type: "hub_change", ts: nowISO() });
  res.json({ ok: true });
});

router.get("/:id/zip", (req, res) => {
  const row = db.prepare("SELECT * FROM hub_collections WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "Collection not found." });
  const resourceIds = db.prepare("SELECT resource_id FROM hub_collection_resources WHERE collection_id = ?").all(row.id).map(r => r.resource_id);
  if (!resourceIds.length) return res.status(400).json({ error: "This collection has no resources yet." });
  const placeholders = resourceIds.map(() => "?").join(",");
  const resources = db.prepare(`SELECT * FROM hub_resources WHERE id IN (${placeholders})`).all(...resourceIds);
  const withFiles = resources.filter(r => r.current_file_path && fs.existsSync(path.join(RESOURCES_DIR, r.current_file_path)));

  if (!withFiles.length) return res.status(404).json({ error: "None of the resources in this collection have a stored file." });

  res.attachment(row.slug + ".zip");
  const archive = archiver("zip", { zlib: { level: 9 } });
  archive.on("error", (err) => { res.status(500).end(); });
  archive.pipe(res);
  const usedNames = {};
  withFiles.forEach(r => {
    let name = r.current_file_name || (r.title + "." + (r.current_file_ext || "bin"));
    if (usedNames[name]) name = r.id + "_" + name;
    usedNames[name] = true;
    archive.file(path.join(RESOURCES_DIR, r.current_file_path), { name });
  });
  archive.finalize();

  withFiles.forEach(r => db.prepare("UPDATE hub_resources SET download_count = download_count + 1 WHERE id = ?").run(r.id));
  logAudit({ adminId: req.admin ? req.admin.id : null, adminName: req.admin ? req.admin.name : "System", action: "downloaded", module: "executive_hub", targetType: "collection", targetLabel: row.name, targetId: row.id, details: withFiles.length + " of " + resources.length + " files included" });
});

module.exports = router;
