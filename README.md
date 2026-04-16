# RecruitLog — Project 3 (Redis Practicum)

RecruitLog is a job and internship tracking system for students, applicants, and advisors.

This project extends the MongoDB-based Project 2 by introducing a **Redis in-memory layer** for fast, high-churn advisor interaction data, while keeping durable business records in MongoDB.

> **AI Disclosure:** Portions of the code structure, comments, and documentation were generated with assistance from Claude (Anthropic). All Redis data structure decisions, query design, and application architecture were reviewed and validated by the project team.

---

## Video Demo

*[Video link to be added here before final submission.]*

---

## Project 3 Objective

- **MongoDB** — authoritative, durable records (companies, applicants, listings, applications, advisors).
- **Redis** — fast, high-churn operational data (advisor bookmarks, recent views, listing stat counters).

If MongoDB and Redis ever disagree, MongoDB is treated as correct.

---

## Problem Requirements

1. Company and listing management (internship and full-time subtypes).
2. Applicant profile and skill tracking.
3. Listing requirements by skill and proficiency level.
4. Application lifecycle tracking (applied → accepted / rejected / withdrawn).
5. Advisor monitoring workflows.
6. **Fast advisor-facing interactions: bookmarks and recently viewed listings (Redis).**
7. **Cached listing counters for advisor dashboard reads (Redis).**

---

## Conceptual Model (UML)

Reused from previous projects. See `docs/project-1-UML-Diagram.png` for the full diagram.

| Class | Description |
|---|---|
| Company | Hiring organization |
| JobListing | Job or internship posting |
| Internship | Subtype of JobListing |
| FullTimePosition | Subtype of JobListing |
| Skill | Technical skill |
| Applicant | Job seeker |
| ApplicantSkill | M:N — applicant ↔ skill |
| ListingRequirement | M:N — listing ↔ skill |
| Application | Applicant's submission to a listing |
| Advisor | Faculty member or career counselor |
| AdvisorBookmark | Advisor's saved listing → **moved to Redis** |

**Selected for Redis:** `AdvisorBookmark`, recently viewed listings, and listing-level counters — because they are read-heavy, update frequently, and can be refreshed from MongoDB at any time.

---

## Redis Data Structures

### 1. Advisor Bookmarks — Sorted Set

| Property | Value |
|---|---|
| Key | `advisor:{advisorId}:bookmarks` |
| Type | Sorted Set |
| Member | listing ID (string) |
| Score | Unix timestamp ms (time of bookmark) |

**Why:** Sorted sets give O(log N) insert/remove and O(N) range reads ordered by recency. An advisor can bookmark hundreds of listings; we always want newest first.

### 2. Recently Viewed Listings — Sorted Set

| Property | Value |
|---|---|
| Key | `advisor:{advisorId}:recentViews` |
| Type | Sorted Set |
| Member | listing ID (string) |
| Score | Unix timestamp ms (time of last view) |

**Why:** Same structure as bookmarks but semantics differ — viewing is write-heavy (every page load) while bookmarking is intentional. Kept separate so each can be TTL'd or trimmed independently. Capped at 50 entries using `ZREMRANGEBYRANK`.

### 3. Listing Stats Cache — Hash

| Property | Value |
|---|---|
| Key | `listing:{listingId}:stats` |
| Type | Hash |
| Fields | `applicationCount`, `bookmarkCount`, `lastUpdated` |

**Why:** A hash lets us read or increment individual counters with `HGET` / `HINCRBY` in O(1) without loading the full MongoDB document.

---

## Redis CRUD Commands

### A. Advisor Bookmarks (Sorted Set)

```redis
# Initialize
FLUSHALL

# CREATE — add a bookmark
ZADD advisor:advisor_1:bookmarks 1713225000000 listing_7

# READ — all bookmarks, newest first
ZREVRANGE advisor:advisor_1:bookmarks 0 -1 WITHSCORES

# READ — check if a listing is bookmarked (nil = not present)
ZSCORE advisor:advisor_1:bookmarks listing_7

# UPDATE — refresh timestamp on an existing bookmark (XX = only if exists)
ZADD advisor:advisor_1:bookmarks XX 1713311400000 listing_7

# DELETE — remove one bookmark
ZREM advisor:advisor_1:bookmarks listing_7

# DELETE — remove all bookmarks for an advisor
DEL advisor:advisor_1:bookmarks
```

### B. Recently Viewed Listings (Sorted Set)

```redis
# CREATE / UPDATE — record or re-record a view (upserts score)
ZADD advisor:advisor_1:recentViews 1713225000000 listing_9

# READ — top 50 most recently viewed, newest first
ZREVRANGE advisor:advisor_1:recentViews 0 49 WITHSCORES

# READ — count entries
ZCARD advisor:advisor_1:recentViews

# MAINTAIN — trim to 50 most recent after each insert
ZREMRANGEBYRANK advisor:advisor_1:recentViews 0 -51

# DELETE — remove one listing from history
ZREM advisor:advisor_1:recentViews listing_9

# DELETE — clear all history for an advisor
DEL advisor:advisor_1:recentViews
```

### C. Listing Stats Cache (Hash)

```redis
# CREATE — initialize stats
HSET listing:listing_7:stats applicationCount 0 bookmarkCount 0 lastUpdated 1713225000000

# READ — all fields
HGETALL listing:listing_7:stats

# READ — one field
HGET listing:listing_7:stats applicationCount

# UPDATE — increment application count
HINCRBY listing:listing_7:stats applicationCount 1

# UPDATE — increment bookmark count
HINCRBY listing:listing_7:stats bookmarkCount 1

# UPDATE — set lastUpdated timestamp
HSET listing:listing_7:stats lastUpdated 1713311400000

# DELETE — remove all stats for a listing
DEL listing:listing_7:stats
```

---

## Application — Node + Express + Redis

### Tech Stack

- **Node.js + Express 4**
- **redis v4** — official async/await Redis client
- **EJS** — server-side templating
- **Bootstrap 5** — UI (CDN)
- **method-override** — PUT/DELETE from HTML forms

### Prerequisites

- Node.js 18+
- Redis running locally on port 6379

```bash
# macOS (Homebrew)
brew install redis
brew services start redis

# Or run directly
redis-server
```

### Setup & Run

```bash
cd app
npm install
npm start
# development (auto-reload):
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection URL |

---

## Application Routes

### Advisor Bookmarks

| Method | Route | Redis Op | Description |
|---|---|---|---|
| GET | `/advisors/:id/bookmarks` | `ZREVRANGE … WITHSCORES` | View all bookmarks |
| POST | `/advisors/:id/bookmarks` | `ZADD … {score} {id}` | Add bookmark |
| POST | `/advisors/:id/bookmarks/:lid/refresh` | `ZADD … XX {score} {id}` | Refresh timestamp |
| DELETE | `/advisors/:id/bookmarks/:lid` | `ZREM …` | Remove bookmark |

### Recently Viewed Listings

| Method | Route | Redis Op | Description |
|---|---|---|---|
| GET | `/advisors/:id/recent-views` | `ZREVRANGE 0 49 WITHSCORES` | View history |
| POST | `/advisors/:id/recent-views` | `ZADD … {score} {id}` | Record view |
| DELETE | `/advisors/:id/recent-views/:lid` | `ZREM …` | Remove single entry |
| DELETE | `/advisors/:id/recent-views` | `DEL …` | Clear all history |

### Listing Stats

| Method | Route | Redis Op | Description |
|---|---|---|---|
| GET | `/listings/stats` | `KEYS` + `HGETALL` | List all stats |
| POST | `/listings/stats` | `HSET …` | Create / overwrite stats |
| GET | `/listings/:id/stats` | `HGETALL …` | View one listing |
| POST | `/listings/:id/stats/increment` | `HINCRBY … 1` | Increment a counter |
| DELETE | `/listings/:id/stats` | `DEL …` | Delete stats |

---

## Repository Structure

```
.
├── README.md
├── app/
│   ├── package.json
│   ├── app.js                      ← Express server + Redis startup
│   ├── db/
│   │   └── redisClient.js          ← All Redis CRUD operations + seed
│   ├── routes/
│   │   └── index.js                ← Route handlers
│   └── views/
│       ├── layout/
│       │   ├── header.ejs
│       │   └── footer.ejs
│       ├── index.ejs
│       ├── advisors.ejs
│       ├── advisor-bookmarks.ejs
│       ├── advisor-recent-views.ejs
│       ├── listing-stats-index.ejs
│       ├── listing-stats.ejs
│       └── error.ejs
└── docs/
    ├── database-decisions.md       ← Task 1: Requirements + UML + Redis rationale
    ├── project-1-UML-Diagram.png
    ├── project-1-ERD-Diagram.png
    ├── project-1-ERD-mermaid.pdf
    ├── project-1-UML-mermaid.pdf
    ├── project-1-requirements-document.pdf
    └── project-1-schema-BCNF.pdf
```

---

## Grading Rubric Coverage

| Item | Pts | Coverage |
|---|---|---|
| Requirements + UML conceptual model | 10 | `docs/database-decisions.md` + README above |
| Redis data structure descriptions | 30 | "Redis Data Structures" section |
| Redis CRUD commands | 30 | "Redis CRUD Commands" section |
| Node + Express + Redis app | 30 | `app/` directory |
| Video | 20 | *Link TBD* |
| GitHub best practices + AI disclosure | 30 | README structure, commit messages, AI disclosure |
