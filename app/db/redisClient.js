const { createClient } = require("redis");

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

let client;

// ─── CONNECTION ──────────────────────────────────────────────

async function connect() {
  if (client) return client;
  client = createClient({ url: REDIS_URL });
  client.on("error", (err) => console.error("Redis error:", err));
  await client.connect();
  console.log("Connected to Redis");
  await seed();
  return client;
}

async function getClient() {
  if (!client) await connect();
  return client;
}

// ─── SEED DATA ───────────────────────────────────────────────
// Pre-populate sample bookmarks and stats so the app has data on first load.

async function seed() {
  const c = client;
  const now = Date.now();

  // Only seed once
  const exists = await c.exists("advisor:advisor_1:bookmarks");
  if (exists) return;

  // Advisor 1 bookmarks
  await c.zAdd("advisor:advisor_1:bookmarks", [
    { score: now - 86400000, value: "listing_3" },
    { score: now - 43200000, value: "listing_7" },
    { score: now,            value: "listing_12" },
  ]);

  // Advisor 2 bookmarks
  await c.zAdd("advisor:advisor_2:bookmarks", [
    { score: now - 72000000, value: "listing_1" },
    { score: now - 3600000,  value: "listing_5" },
  ]);

  // Advisor 1 recent views
  await c.zAdd("advisor:advisor_1:recentViews", [
    { score: now - 90000000, value: "listing_2" },
    { score: now - 50000000, value: "listing_7" },
    { score: now - 10000000, value: "listing_9" },
    { score: now,            value: "listing_12" },
  ]);

  // Listing stats
  await c.hSet("listing:listing_3:stats",  { applicationCount: "8",  bookmarkCount: "3", lastUpdated: String(now) });
  await c.hSet("listing:listing_7:stats",  { applicationCount: "15", bookmarkCount: "5", lastUpdated: String(now) });
  await c.hSet("listing:listing_12:stats", { applicationCount: "4",  bookmarkCount: "2", lastUpdated: String(now) });

  console.log("Redis seed data loaded");
}

// ─── BOOKMARKS (Sorted Set) ──────────────────────────────────
// Key:    advisor:{advisorId}:bookmarks
// Member: listingId
// Score:  Unix timestamp ms (when bookmarked)

async function getBookmarks(advisorId) {
  const c = await getClient();
  // ZREVRANGE … 0 -1 WITHSCORES  — newest first
  const results = await c.zRangeWithScores(`advisor:${advisorId}:bookmarks`, 0, -1, { REV: true });
  return results.map((r) => ({
    listingId: r.value,
    bookmarkedAt: new Date(r.score).toLocaleString(),
    score: r.score,
  }));
}

async function addBookmark(advisorId, listingId) {
  const c = await getClient();
  // ZADD advisor:{advisorId}:bookmarks {score} {listingId}
  await c.zAdd(`advisor:${advisorId}:bookmarks`, [{ score: Date.now(), value: listingId }]);
  // Side-effect: increment bookmark counter on listing stats if it exists
  const statsKey = `listing:${listingId}:stats`;
  if (await c.exists(statsKey)) {
    await c.hIncrBy(statsKey, "bookmarkCount", 1);
    await c.hSet(statsKey, "lastUpdated", String(Date.now()));
  }
}

async function refreshBookmark(advisorId, listingId) {
  const c = await getClient();
  // ZADD XX — only updates score if member already exists
  await c.zAdd(`advisor:${advisorId}:bookmarks`, [{ score: Date.now(), value: listingId }], { XX: true });
}

async function removeBookmark(advisorId, listingId) {
  const c = await getClient();
  // ZREM advisor:{advisorId}:bookmarks {listingId}
  await c.zRem(`advisor:${advisorId}:bookmarks`, listingId);
}

async function isBookmarked(advisorId, listingId) {
  const c = await getClient();
  // ZSCORE returns null if member not present
  const score = await c.zScore(`advisor:${advisorId}:bookmarks`, listingId);
  return score !== null;
}

// ─── RECENT VIEWS (Sorted Set) ───────────────────────────────
// Key:    advisor:{advisorId}:recentViews
// Member: listingId
// Score:  Unix timestamp ms (when last viewed)

async function getRecentViews(advisorId) {
  const c = await getClient();
  // ZREVRANGE … 0 49 WITHSCORES  — top 50, newest first
  const results = await c.zRangeWithScores(`advisor:${advisorId}:recentViews`, 0, 49, { REV: true });
  return results.map((r) => ({
    listingId: r.value,
    viewedAt: new Date(r.score).toLocaleString(),
    score: r.score,
  }));
}

async function recordView(advisorId, listingId) {
  const c = await getClient();
  // ZADD (upsert) — updates score if member already exists
  await c.zAdd(`advisor:${advisorId}:recentViews`, [{ score: Date.now(), value: listingId }]);
  // ZREMRANGEBYRANK — keep only the 50 most recent
  await c.zRemRangeByRank(`advisor:${advisorId}:recentViews`, 0, -51);
}

async function removeRecentView(advisorId, listingId) {
  const c = await getClient();
  // ZREM advisor:{advisorId}:recentViews {listingId}
  await c.zRem(`advisor:${advisorId}:recentViews`, listingId);
}

async function clearRecentViews(advisorId) {
  const c = await getClient();
  // DEL advisor:{advisorId}:recentViews
  await c.del(`advisor:${advisorId}:recentViews`);
}

// ─── LISTING STATS (Hash) ────────────────────────────────────
// Key:    listing:{listingId}:stats
// Fields: applicationCount, bookmarkCount, lastUpdated

async function getListingStats(listingId) {
  const c = await getClient();
  // HGETALL listing:{listingId}:stats
  return c.hGetAll(`listing:${listingId}:stats`);
}

async function createListingStats(listingId, data) {
  const c = await getClient();
  // HSET listing:{listingId}:stats applicationCount X bookmarkCount Y lastUpdated Z
  await c.hSet(`listing:${listingId}:stats`, {
    applicationCount: String(parseInt(data.applicationCount) || 0),
    bookmarkCount:    String(parseInt(data.bookmarkCount)    || 0),
    lastUpdated:      String(Date.now()),
  });
}

async function incrementStat(listingId, field) {
  const c = await getClient();
  // HINCRBY listing:{listingId}:stats {field} 1
  await c.hIncrBy(`listing:${listingId}:stats`, field, 1);
  await c.hSet(`listing:${listingId}:stats`, "lastUpdated", String(Date.now()));
}

async function deleteListingStats(listingId) {
  const c = await getClient();
  // DEL listing:{listingId}:stats
  await c.del(`listing:${listingId}:stats`);
}

async function getAllListingStatKeys() {
  const c = await getClient();
  const keys = await c.keys("listing:*:stats");
  return keys.map((k) => k.replace("listing:", "").replace(":stats", "")).sort();
}

module.exports = {
  connect,
  getBookmarks,
  addBookmark,
  refreshBookmark,
  removeBookmark,
  isBookmarked,
  getRecentViews,
  recordView,
  removeRecentView,
  clearRecentViews,
  getListingStats,
  createListingStats,
  incrementStat,
  deleteListingStats,
  getAllListingStatKeys,
};
