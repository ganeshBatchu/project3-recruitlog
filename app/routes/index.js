const express = require("express");
const router = express.Router();
const redis = require("../db/redisClient");

// Sample advisors — in a full app these would live in MongoDB
const ADVISORS = [
  { id: "advisor_1", name: "Dr. Sarah Chen",    role: "Faculty Advisor",          institution: "Northeastern University" },
  { id: "advisor_2", name: "Marcus Rivera",     role: "Career Center Counselor",  institution: "Boston University" },
  { id: "advisor_3", name: "Prof. Aisha Patel", role: "Institutional Researcher", institution: "MIT" },
];

// Sample listings — in a full app these would live in MongoDB
const LISTINGS = [
  { id: "listing_1",  title: "Software Engineer Intern — Google",      company: "Google" },
  { id: "listing_2",  title: "Backend Intern — Meta",                  company: "Meta" },
  { id: "listing_3",  title: "ML Engineer Intern — OpenAI",            company: "OpenAI" },
  { id: "listing_4",  title: "Frontend Intern — Stripe",               company: "Stripe" },
  { id: "listing_5",  title: "Data Engineer Intern — Databricks",      company: "Databricks" },
  { id: "listing_6",  title: "SRE Intern — Cloudflare",                company: "Cloudflare" },
  { id: "listing_7",  title: "Full-Stack Engineer — Figma",            company: "Figma" },
  { id: "listing_8",  title: "iOS Engineer — Apple",                   company: "Apple" },
  { id: "listing_9",  title: "Security Intern — CrowdStrike",          company: "CrowdStrike" },
  { id: "listing_10", title: "Cloud Infra Intern — Amazon",            company: "Amazon" },
  { id: "listing_11", title: "Compiler Intern — NVIDIA",               company: "NVIDIA" },
  { id: "listing_12", title: "Distributed Systems Intern — Snowflake", company: "Snowflake" },
  { id: "listing_13", title: "Product Engineer Intern — Notion",       company: "Notion" },
  { id: "listing_14", title: "Platform Engineer — Vercel",             company: "Vercel" },
];

// ─── HOME ────────────────────────────────────────────────────

router.get("/", (req, res) => {
  res.render("index", { title: "Home", advisors: ADVISORS });
});

// ─── ADVISORS ────────────────────────────────────────────────

router.get("/advisors", (req, res) => {
  res.render("advisors", { title: "Advisors", advisors: ADVISORS });
});

// ─── BOOKMARKS (Sorted Set) ──────────────────────────────────

// READ — list all bookmarks for an advisor
router.get("/advisors/:id/bookmarks", async (req, res) => {
  try {
    const advisor = ADVISORS.find((a) => a.id === req.params.id);
    if (!advisor) return res.status(404).render("error", { title: "Not Found", message: "Advisor not found." });
    const bookmarks = await redis.getBookmarks(req.params.id);
    res.render("advisor-bookmarks", { title: `${advisor.name} — Bookmarks`, advisor, bookmarks, listings: LISTINGS });
  } catch (err) {
    console.error(err);
    res.status(500).render("error", { title: "Error", message: err.message });
  }
});

// CREATE — add a bookmark (ZADD)
router.post("/advisors/:id/bookmarks", async (req, res) => {
  try {
    const { listingId } = req.body;
    if (listingId) await redis.addBookmark(req.params.id, listingId);
    res.redirect(`/advisors/${req.params.id}/bookmarks`);
  } catch (err) {
    console.error(err);
    res.status(500).render("error", { title: "Error", message: err.message });
  }
});

// UPDATE — refresh bookmark timestamp (ZADD XX)
router.post("/advisors/:id/bookmarks/:listingId/refresh", async (req, res) => {
  try {
    await redis.refreshBookmark(req.params.id, req.params.listingId);
    res.redirect(`/advisors/${req.params.id}/bookmarks`);
  } catch (err) {
    console.error(err);
    res.status(500).render("error", { title: "Error", message: err.message });
  }
});

// DELETE — remove a bookmark (ZREM)
router.delete("/advisors/:id/bookmarks/:listingId", async (req, res) => {
  try {
    await redis.removeBookmark(req.params.id, req.params.listingId);
    res.redirect(`/advisors/${req.params.id}/bookmarks`);
  } catch (err) {
    console.error(err);
    res.status(500).render("error", { title: "Error", message: err.message });
  }
});

// ─── RECENT VIEWS (Sorted Set) ───────────────────────────────

// READ — list recent views for an advisor
router.get("/advisors/:id/recent-views", async (req, res) => {
  try {
    const advisor = ADVISORS.find((a) => a.id === req.params.id);
    if (!advisor) return res.status(404).render("error", { title: "Not Found", message: "Advisor not found." });
    const views = await redis.getRecentViews(req.params.id);
    res.render("advisor-recent-views", { title: `${advisor.name} — Recent Views`, advisor, views, listings: LISTINGS });
  } catch (err) {
    console.error(err);
    res.status(500).render("error", { title: "Error", message: err.message });
  }
});

// CREATE/UPDATE — record a view (ZADD upsert)
router.post("/advisors/:id/recent-views", async (req, res) => {
  try {
    const { listingId } = req.body;
    if (listingId) await redis.recordView(req.params.id, listingId);
    res.redirect(`/advisors/${req.params.id}/recent-views`);
  } catch (err) {
    console.error(err);
    res.status(500).render("error", { title: "Error", message: err.message });
  }
});

// DELETE — remove single entry from history (ZREM)
router.delete("/advisors/:id/recent-views/:listingId", async (req, res) => {
  try {
    await redis.removeRecentView(req.params.id, req.params.listingId);
    res.redirect(`/advisors/${req.params.id}/recent-views`);
  } catch (err) {
    console.error(err);
    res.status(500).render("error", { title: "Error", message: err.message });
  }
});

// DELETE — clear all history for advisor (DEL key)
router.delete("/advisors/:id/recent-views", async (req, res) => {
  try {
    await redis.clearRecentViews(req.params.id);
    res.redirect(`/advisors/${req.params.id}/recent-views`);
  } catch (err) {
    console.error(err);
    res.status(500).render("error", { title: "Error", message: err.message });
  }
});

// ─── LISTING STATS (Hash) ────────────────────────────────────

// READ — index of all listing stats keys
router.get("/listings/stats", async (req, res) => {
  try {
    const listingIds = await redis.getAllListingStatKeys();
    const stats = [];
    for (const id of listingIds) {
      const data = await redis.getListingStats(id);
      const meta = LISTINGS.find((l) => l.id === id);
      stats.push({ id, data, meta });
    }
    res.render("listing-stats-index", { title: "Listing Stats", stats, listings: LISTINGS });
  } catch (err) {
    console.error(err);
    res.status(500).render("error", { title: "Error", message: err.message });
  }
});

// CREATE — initialize stats for a listing (HSET)
router.post("/listings/stats", async (req, res) => {
  try {
    const { listingId, applicationCount, bookmarkCount } = req.body;
    if (listingId) await redis.createListingStats(listingId, { applicationCount, bookmarkCount });
    res.redirect(`/listings/${listingId}/stats`);
  } catch (err) {
    console.error(err);
    res.status(500).render("error", { title: "Error", message: err.message });
  }
});

// READ — detail for one listing (HGETALL)
router.get("/listings/:id/stats", async (req, res) => {
  try {
    const stats = await redis.getListingStats(req.params.id);
    const meta = LISTINGS.find((l) => l.id === req.params.id);
    const lastUpdated = stats.lastUpdated
      ? new Date(parseInt(stats.lastUpdated)).toLocaleString()
      : "—";
    res.render("listing-stats", {
      title: `Stats — ${req.params.id}`,
      listingId: req.params.id,
      stats,
      meta,
      lastUpdated,
    });
  } catch (err) {
    console.error(err);
    res.status(500).render("error", { title: "Error", message: err.message });
  }
});

// UPDATE — increment a counter (HINCRBY)
router.post("/listings/:id/stats/increment", async (req, res) => {
  try {
    const { field } = req.body;
    if (field === "applicationCount" || field === "bookmarkCount") {
      await redis.incrementStat(req.params.id, field);
    }
    res.redirect(`/listings/${req.params.id}/stats`);
  } catch (err) {
    console.error(err);
    res.status(500).render("error", { title: "Error", message: err.message });
  }
});

// DELETE — remove stats for a listing (DEL)
router.delete("/listings/:id/stats", async (req, res) => {
  try {
    await redis.deleteListingStats(req.params.id);
    res.redirect("/listings/stats");
  } catch (err) {
    console.error(err);
    res.status(500).render("error", { title: "Error", message: err.message });
  }
});

module.exports = router;
