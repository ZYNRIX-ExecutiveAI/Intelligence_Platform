// src/routes/admin/clients.js
const express = require("express");
const { db } = require("../../db");

const router = express.Router();

router.get("/", (req, res) => {
  const clients = db.prepare("SELECT * FROM clients ORDER BY registered_at DESC").all();
  const attemptsStmt = db.prepare("SELECT * FROM assessment_attempts WHERE client_id = ? ORDER BY started_at ASC");

  const out = clients.map(c => {
    const attempts = attemptsStmt.all(c.id).map(a => ({
      id: a.id, startedAt: a.started_at, completedAt: a.completed_at,
      dimensionScores: a.dimension_scores ? JSON.parse(a.dimension_scores) : null,
      total: a.total_score, tier: a.tier, reportGeneratedAt: a.report_generated_at
    }));
    const hasCompleted = attempts.some(a => a.completedAt);
    const status = attempts.length === 0 ? "not_started" : (hasCompleted ? "completed" : "in_progress");
    return {
      id: c.id, name: c.name || "(name not provided)", email: c.email || "",
      organization: c.organization || "(organization not provided)", industry: c.industry || "",
      country: c.country || "", jobTitle: c.job_title || "", companySize: c.company_size || "",
      assessmentPurpose: c.assessment_purpose || "",
      registeredAt: c.registered_at, lastActivityAt: c.last_activity_at,
      status, attempts
    };
  });
  res.json(out);
});

module.exports = router;
