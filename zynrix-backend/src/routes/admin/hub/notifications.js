// src/routes/admin/hub/notifications.js
const express = require("express");
const { db, uuid, nowISO } = require("../../../db");
const { requirePermission } = require("../../../auth");
const { logAudit } = require("../../../utils");

const router = express.Router();

function rowToJSON(n){
  return {
    id: n.id, title: n.title, message: n.message, targetAudience: n.target_audience,
    channels: n.channels ? JSON.parse(n.channels) : [], startDate: n.start_date, endDate: n.end_date,
    priority: n.priority, dismissible: !!n.dismissible, ctaLabel: n.cta_label,
    resourceId: n.resource_id, collectionId: n.collection_id, createdAt: n.created_at, createdBy: n.created_by
  };
}

router.get("/", (req, res) => {
  const rows = db.prepare("SELECT * FROM hub_notifications ORDER BY created_at DESC").all();
  res.json(rows.map(rowToJSON));
});

router.post("/", requirePermission("manage_notifications"), (req, res) => {
  const b = req.body || {};
  if (!b.title || !b.title.trim()) return res.status(400).json({ error: "Notification title is required." });
  const id = uuid();
  db.prepare(`INSERT INTO hub_notifications (id,title,message,target_audience,channels,start_date,end_date,priority,dismissible,cta_label,resource_id,collection_id,created_at,created_by)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, b.title.trim(), b.message||"", b.targetAudience||"all_registered", JSON.stringify(b.channels||["in_app"]),
         b.startDate||nowISO(), b.endDate||null, b.priority||"normal", b.dismissible===false?0:1, b.ctaLabel||"",
         b.resourceId||null, b.collectionId||null, nowISO(), req.admin.name);
  logAudit({ adminId: req.admin.id, adminName: req.admin.name, action: "created", module: "executive_hub", targetType: "notification", targetLabel: b.title, targetId: id });
  res.status(201).json({ id });
});

router.patch("/:id", requirePermission("manage_notifications"), (req, res) => {
  const row = db.prepare("SELECT * FROM hub_notifications WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "Notification not found." });
  const b = req.body || {};
  db.prepare(`UPDATE hub_notifications SET title=?, message=?, target_audience=?, channels=?, start_date=?, end_date=?, priority=?, dismissible=?, cta_label=?, resource_id=?, collection_id=? WHERE id=?`)
    .run(b.title||row.title, b.message!=null?b.message:row.message, b.targetAudience||row.target_audience,
         b.channels ? JSON.stringify(b.channels) : row.channels, b.startDate||row.start_date, b.endDate!==undefined?b.endDate:row.end_date,
         b.priority||row.priority, b.dismissible!=null?(b.dismissible?1:0):row.dismissible, b.ctaLabel!=null?b.ctaLabel:row.cta_label,
         b.resourceId!==undefined?b.resourceId:row.resource_id, b.collectionId!==undefined?b.collectionId:row.collection_id, row.id);
  logAudit({ adminId: req.admin.id, adminName: req.admin.name, action: "edited", module: "executive_hub", targetType: "notification", targetLabel: b.title || row.title, targetId: row.id });
  res.json({ ok: true });
});

router.delete("/:id", requirePermission("manage_notifications"), (req, res) => {
  const row = db.prepare("SELECT * FROM hub_notifications WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "Notification not found." });
  db.prepare("DELETE FROM hub_notifications WHERE id = ?").run(row.id);
  logAudit({ adminId: req.admin.id, adminName: req.admin.name, action: "deleted", module: "executive_hub", targetType: "notification", targetLabel: row.title, targetId: row.id });
  res.json({ ok: true });
});

module.exports = router;
