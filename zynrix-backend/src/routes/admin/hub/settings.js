// src/routes/admin/hub/settings.js
const express = require("express");
const { db } = require("../../../db");
const { requirePermission } = require("../../../auth");
const { logAudit } = require("../../../utils");

const router = express.Router();

function rowToJSON(s){
  return {
    maxFileSizeMB: s.max_file_size_mb, allowedExtensions: s.allowed_extensions ? JSON.parse(s.allowed_extensions) : [],
    defaultNewBadgeDays: s.default_new_badge_days, defaultAccessLevel: s.default_access_level, defaultWorkflow: s.default_workflow,
    downloadUrlExpiryMinutes: s.download_url_expiry_minutes, publicDownloadsEnabled: !!s.public_downloads_enabled,
    emailNotificationsEnabled: !!s.email_notifications_enabled, autoZipEnabled: !!s.auto_zip_enabled,
    reviewFrequencyDays: s.review_frequency_days, defaultSortOrder: s.default_sort_order, resourcesPerPage: s.resources_per_page,
    analyticsRetentionDays: s.analytics_retention_days, auditRetentionDays: s.audit_retention_days, supportEmail: s.support_email
  };
}

router.get("/", (req, res) => {
  res.json(rowToJSON(db.prepare("SELECT * FROM hub_settings WHERE id = 1").get()));
});

router.patch("/", requirePermission("manage_settings"), (req, res) => {
  const b = req.body || {};
  const row = db.prepare("SELECT * FROM hub_settings WHERE id = 1").get();
  db.prepare(`UPDATE hub_settings SET max_file_size_mb=?, allowed_extensions=?, default_new_badge_days=?, default_access_level=?, default_workflow=?,
              download_url_expiry_minutes=?, public_downloads_enabled=?, email_notifications_enabled=?, auto_zip_enabled=?,
              review_frequency_days=?, default_sort_order=?, resources_per_page=?, analytics_retention_days=?, audit_retention_days=?, support_email=?
              WHERE id = 1`)
    .run(
      b.maxFileSizeMB ?? row.max_file_size_mb, b.allowedExtensions ? JSON.stringify(b.allowedExtensions) : row.allowed_extensions,
      b.defaultNewBadgeDays ?? row.default_new_badge_days, b.defaultAccessLevel || row.default_access_level, b.defaultWorkflow || row.default_workflow,
      b.downloadUrlExpiryMinutes ?? row.download_url_expiry_minutes, b.publicDownloadsEnabled != null ? (b.publicDownloadsEnabled?1:0) : row.public_downloads_enabled,
      b.emailNotificationsEnabled != null ? (b.emailNotificationsEnabled?1:0) : row.email_notifications_enabled,
      b.autoZipEnabled != null ? (b.autoZipEnabled?1:0) : row.auto_zip_enabled,
      b.reviewFrequencyDays ?? row.review_frequency_days, b.defaultSortOrder || row.default_sort_order, b.resourcesPerPage ?? row.resources_per_page,
      b.analyticsRetentionDays ?? row.analytics_retention_days, b.auditRetentionDays ?? row.audit_retention_days, b.supportEmail || row.support_email
    );
  logAudit({ adminId: req.admin.id, adminName: req.admin.name, action: "edited", module: "executive_hub", targetType: "settings", targetLabel: "Executive Hub settings" });
  res.json({ ok: true });
});

module.exports = router;
