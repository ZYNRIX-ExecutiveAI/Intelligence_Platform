// src/routes/admin/overview.js
const express = require("express");
const { db } = require("../../db");

const router = express.Router();

function last30DayKeys(){
  const out = [];
  const d = new Date();
  for (let i = 29; i >= 0; i--) {
    const day = new Date(d);
    day.setDate(d.getDate() - i);
    out.push(day.toISOString().slice(0, 10));
  }
  return out;
}

router.get("/", (req, res) => {
  const days = last30DayKeys();
  const visitRows = db.prepare(`SELECT day, COUNT(*) AS c FROM visit_events WHERE day >= ? GROUP BY day`).all(days[0]);
  const byDay = {};
  visitRows.forEach(r => { byDay[r.day] = r.c; });
  const visitorsSeries = days.map(d => ({ date: d, count: byDay[d] || 0 }));
  const visitorsToday = visitorsSeries[visitorsSeries.length - 1].count;
  const visitors30d = visitorsSeries.reduce((s, p) => s + p.count, 0);

  const clientCounts = db.prepare(`
    SELECT
      SUM(CASE WHEN att.completed_ct > 0 THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN att.completed_ct = 0 AND att.total_ct > 0 THEN 1 ELSE 0 END) AS in_progress,
      SUM(CASE WHEN att.total_ct IS NULL OR att.total_ct = 0 THEN 1 ELSE 0 END) AS not_started,
      COUNT(*) AS total
    FROM clients c
    LEFT JOIN (
      SELECT client_id, COUNT(*) AS total_ct, SUM(CASE WHEN completed_at IS NOT NULL THEN 1 ELSE 0 END) AS completed_ct
      FROM assessment_attempts GROUP BY client_id
    ) att ON att.client_id = c.id
  `).get();

  const startedTotal = db.prepare("SELECT COUNT(*) AS c FROM assessment_attempts").get().c;
  const completedTotal = db.prepare("SELECT COUNT(*) AS c FROM assessment_attempts WHERE completed_at IS NOT NULL").get().c;
  const avgScoreRow = db.prepare("SELECT AVG(total_score) AS avg FROM assessment_attempts WHERE completed_at IS NOT NULL").get();
  const avgScore = avgScoreRow.avg ? Math.round(avgScoreRow.avg) : 0;

  const thumbsUp = db.prepare("SELECT COUNT(*) AS c FROM reactions WHERE kind='up'").get().c;
  const thumbsDown = db.prepare("SELECT COUNT(*) AS c FROM reactions WHERE kind='down'").get().c;
  const ratingAgg = db.prepare("SELECT AVG(rating) AS avg, COUNT(*) AS c FROM reactions WHERE kind='rating'").get();

  const pubResourceCount = db.prepare("SELECT COUNT(*) AS c FROM hub_resources WHERE status='published'").get().c;
  const totalResourceCount = db.prepare("SELECT COUNT(*) AS c FROM hub_resources").get().c;

  const recentActivity = db.prepare("SELECT * FROM audit_log ORDER BY ts DESC LIMIT 10").all();

  res.json({
    visitorsSeries, visitorsToday, visitors30d,
    clientFunnel: { completed: clientCounts.completed || 0, inProgress: clientCounts.in_progress || 0, notStarted: clientCounts.not_started || 0, total: clientCounts.total || 0 },
    assessmentsStartedTotal: startedTotal,
    assessmentsCompletedTotal: completedTotal,
    avgScore,
    reactions: { thumbsUp, thumbsDown, avgRating: ratingAgg.avg ? Number(ratingAgg.avg).toFixed(1) : "0.0", ratingCount: ratingAgg.c },
    hubPublishedResources: pubResourceCount,
    hubTotalResources: totalResourceCount,
    recentActivity: recentActivity.map(a => ({ id: a.id, ts: a.ts, adminName: a.admin_name, action: a.action, module: a.module, targetLabel: a.target_label, details: a.details }))
  });
});

module.exports = router;
