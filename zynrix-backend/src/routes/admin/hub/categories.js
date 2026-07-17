// src/routes/admin/hub/categories.js
const express = require("express");
const { db, uuid, nowISO } = require("../../../db");
const { requirePermission } = require("../../../auth");
const { logAudit } = require("../../../utils");

const router = express.Router();

function slugify(s){ return String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""); }

router.get("/", (req, res) => {
  const rows = db.prepare("SELECT * FROM hub_categories ORDER BY created_at ASC").all();
  res.json(rows.map(c => ({ id: c.id, name: c.name, slug: c.slug, description: c.description, createdAt: c.created_at })));
});

router.post("/", requirePermission("manage_categories"), (req, res) => {
  const { name, description } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: "Category name is required." });
  const id = uuid();
  db.prepare("INSERT INTO hub_categories (id,name,slug,description,created_at) VALUES (?,?,?,?,?)")
    .run(id, name.trim(), slugify(name), (description||"").trim(), nowISO());
  logAudit({ adminId: req.admin.id, adminName: req.admin.name, action: "created", module: "executive_hub", targetType: "category", targetLabel: name, targetId: id });
  res.status(201).json({ id });
});

router.patch("/:id", requirePermission("manage_categories"), (req, res) => {
  const cat = db.prepare("SELECT * FROM hub_categories WHERE id = ?").get(req.params.id);
  if (!cat) return res.status(404).json({ error: "Category not found." });
  const { name, description } = req.body || {};
  const newName = name && name.trim() ? name.trim() : cat.name;
  db.prepare("UPDATE hub_categories SET name=?, slug=?, description=? WHERE id=?")
    .run(newName, slugify(newName), description != null ? description.trim() : cat.description, cat.id);
  logAudit({ adminId: req.admin.id, adminName: req.admin.name, action: "edited", module: "executive_hub", targetType: "category", targetLabel: newName, targetId: cat.id });
  res.json({ ok: true });
});

router.delete("/:id", requirePermission("manage_categories"), (req, res) => {
  const cat = db.prepare("SELECT * FROM hub_categories WHERE id = ?").get(req.params.id);
  if (!cat) return res.status(404).json({ error: "Category not found." });
  const totalCats = db.prepare("SELECT COUNT(*) AS c FROM hub_categories").get().c;
  if (totalCats <= 1) return res.status(400).json({ error: "At least one category must remain." });

  const reassignTo = req.query.reassignTo;
  const affected = db.prepare("SELECT COUNT(*) AS c FROM hub_resources WHERE category_id = ?").get(cat.id).c;
  if (affected > 0) {
    if (!reassignTo) return res.status(409).json({ error: "This category has resources assigned. Pass ?reassignTo=<categoryId> to move them first.", affected });
    const target = db.prepare("SELECT id FROM hub_categories WHERE id = ?").get(reassignTo);
    if (!target) return res.status(400).json({ error: "reassignTo category not found." });
    db.prepare("UPDATE hub_resources SET category_id = ? WHERE category_id = ?").run(reassignTo, cat.id);
  }
  db.prepare("DELETE FROM hub_categories WHERE id = ?").run(cat.id);
  logAudit({ adminId: req.admin.id, adminName: req.admin.name, action: "deleted", module: "executive_hub", targetType: "category", targetLabel: cat.name, targetId: cat.id, details: affected ? ("Reassigned " + affected + " resources") : "" });
  res.json({ ok: true });
});

module.exports = router;
