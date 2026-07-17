// src/routes/admin/hub/analytics.js
const express = require("express");
const { db } = require("../../../db");

const router = express.Router();

router.get("/", (req, res) => {
  const days = Math.min(365, Math.max(1, parseInt(req.query.days, 10) || 30));
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();

  const events = db.prepare("SELECT * FROM hub_events WHERE ts >= ?").all(cutoff);
  const views = events.filter(e => e.type === "view");
  const downloads = events.filter(e => e.type === "download");

  function bucketByDay(items){
    const buckets = {};
    const order = [];
    for (let i = Math.min(days,90) - 1; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0,10);
      buckets[key] = 0; order.push(key);
    }
    items.forEach(it => { const key = it.ts.slice(0,10); if (key in buckets) buckets[key]++; });
    return order.map(k => ({ date: k, count: buckets[k] }));
  }

  const resources = db.prepare("SELECT id, title, category_id FROM hub_resources").all();
  const resourceMap = {}; resources.forEach(r => resourceMap[r.id] = r);
  const categories = db.prepare("SELECT id, name FROM hub_categories").all();
  const categoryMap = {}; categories.forEach(c => categoryMap[c.id] = c.name);
  const collectionLinks = db.prepare("SELECT collection_id, resource_id FROM hub_collection_resources").all();
  const collections = db.prepare("SELECT id, name FROM hub_collections").all();
  const collectionMap = {}; collections.forEach(c => collectionMap[c.id] = c.name);
  const resourceToCollections = {};
  collectionLinks.forEach(l => { (resourceToCollections[l.resource_id] = resourceToCollections[l.resource_id] || []).push(l.collection_id); });

  function topN(counter, n){
    return Object.keys(counter).map(id => ({ label: resourceMap[id] ? resourceMap[id].title : id, value: counter[id] }))
      .sort((a,b) => b.value - a.value).slice(0, n);
  }
  const viewCounts = {}, dlCounts = {};
  views.forEach(e => viewCounts[e.resource_id] = (viewCounts[e.resource_id]||0)+1);
  downloads.forEach(e => dlCounts[e.resource_id] = (dlCounts[e.resource_id]||0)+1);

  const dlByCategory = {}, dlByCollection = {};
  downloads.forEach(e => {
    const r = resourceMap[e.resource_id];
    if (!r) return;
    const catName = categoryMap[r.category_id] || "Uncategorized";
    dlByCategory[catName] = (dlByCategory[catName]||0)+1;
    (resourceToCollections[r.id]||[]).forEach(cid => { const cname = collectionMap[cid]; if (cname) dlByCollection[cname] = (dlByCollection[cname]||0)+1; });
  });

  res.json({
    totalViews: views.length, totalDownloads: downloads.length,
    viewsSeries: bucketByDay(views), downloadsSeries: bucketByDay(downloads),
    topViewed: topN(viewCounts, 6), topDownloaded: topN(dlCounts, 6),
    downloadsByCategory: Object.keys(dlByCategory).map(k => ({ label:k, value:dlByCategory[k] })).sort((a,b)=>b.value-a.value),
    downloadsByCollection: Object.keys(dlByCollection).map(k => ({ label:k, value:dlByCollection[k] })).sort((a,b)=>b.value-a.value)
  });
});

router.get("/export.csv", (req, res) => {
  const rows = db.prepare(`SELECT r.title, r.resource_type, c.name AS category, r.status, r.view_count, r.download_count, r.published_at
                            FROM hub_resources r LEFT JOIN hub_categories c ON c.id = r.category_id`).all();
  const header = ["Resource","Type","Category","Status","Views (all time)","Downloads (all time)","Published"];
  const csvRows = [header].concat(rows.map(r => [r.title, r.resource_type, r.category||"", r.status, r.view_count, r.download_count, r.published_at||""]));
  const csv = csvRows.map(row => row.map(cell => {
    const s = cell == null ? "" : String(cell);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g,'""') + '"' : s;
  }).join(",")).join("\r\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=zynrix_executive_hub_analytics.csv");
  res.send(csv);
});

module.exports = router;
