// src/routes/admin/adminTeam.js
const express = require("express");
const bcrypt = require("bcryptjs");
const { db, uuid, nowISO } = require("../../db");
const { requirePermission, ROLES } = require("../../auth");
const { logAudit } = require("../../utils");

const router = express.Router();

router.get("/", (req, res) => {
  const rows = db.prepare("SELECT id, name, email, role, created_at, last_login_at FROM admin_users ORDER BY created_at ASC").all();
  res.json(rows.map(r => ({ id: r.id, name: r.name, email: r.email, role: r.role, createdAt: r.created_at, lastLoginAt: r.last_login_at })));
});

router.post("/", requirePermission("manage_admins"), (req, res) => {
  const { name, email, role, password } = req.body || {};
  if (!name || !email || !role || !password) return res.status(400).json({ error: "name, email, role, and password are required." });
  if (!ROLES[role]) return res.status(400).json({ error: "Unknown role." });
  const existing = db.prepare("SELECT id FROM admin_users WHERE email = ?").get(String(email).toLowerCase().trim());
  if (existing) return res.status(409).json({ error: "An admin with that email already exists." });
  const id = uuid();
  const hash = bcrypt.hashSync(password, 10);
  db.prepare("INSERT INTO admin_users (id,name,email,password_hash,role,created_at) VALUES (?,?,?,?,?,?)")
    .run(id, name.trim(), String(email).toLowerCase().trim(), hash, role, nowISO());
  logAudit({ adminId: req.admin.id, adminName: req.admin.name, action: "added", module: "admin_team", targetType: "admin", targetLabel: name, targetId: id, details: ROLES[role] ? role : "" });
  res.status(201).json({ id });
});

router.patch("/:id", requirePermission("manage_admins"), (req, res) => {
  const target = db.prepare("SELECT * FROM admin_users WHERE id = ?").get(req.params.id);
  if (!target) return res.status(404).json({ error: "Admin not found." });
  const { role } = req.body || {};
  if (role && !ROLES[role]) return res.status(400).json({ error: "Unknown role." });
  if (role && target.role === "super_admin" && role !== "super_admin") {
    const remaining = db.prepare("SELECT COUNT(*) AS c FROM admin_users WHERE role='super_admin' AND id != ?").get(target.id).c;
    if (remaining === 0) return res.status(400).json({ error: "At least one Super Admin must remain." });
  }
  db.prepare("UPDATE admin_users SET role = COALESCE(?, role) WHERE id = ?").run(role || null, target.id);
  logAudit({ adminId: req.admin.id, adminName: req.admin.name, action: "edited", module: "admin_team", targetType: "admin", targetLabel: target.name, targetId: target.id, details: "Role -> " + role });
  res.json({ ok: true });
});

router.delete("/:id", requirePermission("manage_admins"), (req, res) => {
  const target = db.prepare("SELECT * FROM admin_users WHERE id = ?").get(req.params.id);
  if (!target) return res.status(404).json({ error: "Admin not found." });
  if (target.id === req.admin.id) return res.status(400).json({ error: "You can't remove your own account while signed in." });
  if (target.role === "super_admin") {
    const remaining = db.prepare("SELECT COUNT(*) AS c FROM admin_users WHERE role='super_admin' AND id != ?").get(target.id).c;
    if (remaining === 0) return res.status(400).json({ error: "At least one Super Admin must remain." });
  }
  db.prepare("DELETE FROM admin_users WHERE id = ?").run(target.id);
  logAudit({ adminId: req.admin.id, adminName: req.admin.name, action: "removed", module: "admin_team", targetType: "admin", targetLabel: target.name, targetId: target.id, details: "" });
  res.json({ ok: true });
});

module.exports = router;
