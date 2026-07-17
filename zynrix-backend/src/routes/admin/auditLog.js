// src/routes/admin/auditLog.js
const express = require("express");
const { db } = require("../../db");

const router = express.Router();

router.get("/", (req, res) => {
  const rows = db.prepare("SELECT * FROM audit_log ORDER BY ts DESC LIMIT 2000").all();
  res.json(rows.map(a => ({ id: a.id, ts: a.ts, adminName: a.admin_name, action: a.action, module: a.module, targetType: a.target_type, targetLabel: a.target_label, targetId: a.target_id, details: a.details })));
});

module.exports = router;
