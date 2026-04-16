# RecruitLog Practicum: Requirements and Conceptual Model (Task 1)

This document covers the first rubric item:

- Problem requirements.
- Conceptual model (UML).
- The functionality selected for in-memory key-value storage and why.

---

## 1. Problem Requirements

RecruitLog is a job and internship tracking system for students, applicants, and advisors in a university CS career context.

The system must support:

1. Store companies and their job listings.
2. Support listing subtypes: internship (season, co-op, duration) and full-time (employment type, remote policy).
3. Store applicants, their skills, and their submitted applications.
4. Store listing requirements by skill and proficiency level.
5. Allow advisors to monitor listings and applicant activity.
6. Support advisor interaction data: bookmarked listings and recently viewed listings.
7. Keep durable records for official history (applications, profiles, listings).
8. Provide fast reads for advisor dashboard interactions.

---

## 2. Conceptual Model (UML)

We reuse the UML/conceptual model from Project 1 (see `project-1-UML-Diagram.png` in this directory).

### Core classes

| Class | Key Attributes |
|---|---|
| Company | company_id, company_name, industry, size, location |
| JobListing | listing_id, title, role_type, location, salary_range, is_active |
| Internship | (extends JobListing) season, is_coop, duration |
| FullTimePosition | (extends JobListing) employment_type, signing_bonus, remote_policy |
| Skill | skill_id, skill_name, skill_type |
| Applicant | applicant_id, email, username, university, gpa, degree_level |
| ApplicantSkill | applicant_id + skill_id, proficiency_level, years_used |
| ListingRequirement | listing_id + skill_id, is_required, desired_proficiency |
| Application | application_id, status, applied_date, rejection_stage, offer_salary |
| Advisor | advisor_id, email, role, institution, department |
| AdvisorBookmark | advisor_id + listing_id, last_viewed, is_bookmarked |

### Main relationships

- A Company posts many JobListings.
- A JobListing specializes into either Internship or FullTimePosition.
- Applicants submit Applications to JobListings.
- Applicants and Skills are connected through ApplicantSkill (M:N).
- JobListings and Skills are connected through ListingRequirement (M:N).
- Advisors interact with JobListings through AdvisorBookmark.

---

## 3. Selected In-Memory Key-Value Functionality

We selected advisor-facing interaction data for the Redis layer. These are the three features moved from MongoDB to Redis:

### Feature 1: Advisor Bookmarks

**What it is:** Each advisor has a set of bookmarked job listings. They add, remove, and view these frequently during their advising sessions.

**Why Redis:** Bookmarks are read on almost every advisor page load. They change often (advisors bookmark and un-bookmark listings frequently). Using Redis means we never need a MongoDB round-trip for this dashboard widget.

**Redis structure:** Sorted Set  
**Key:** `advisor:{advisorId}:bookmarks`  
**Member:** listing ID  
**Score:** Unix timestamp ms (when bookmarked, so newest is first)

### Feature 2: Recently Viewed Listings

**What it is:** Each advisor has an automatically maintained history of the listing pages they have visited, capped at 50 entries.

**Why Redis:** View events happen on every listing page load — this is extremely write-heavy and low-value to persist to disk permanently. Redis sorted sets handle high-frequency upserts (updating score on revisit) natively and efficiently.

**Redis structure:** Sorted Set  
**Key:** `advisor:{advisorId}:recentViews`  
**Member:** listing ID  
**Score:** Unix timestamp ms (last view time)

### Feature 3: Listing Stats Cache

**What it is:** Each listing has a small set of aggregate counters (application count, bookmark count) that advisors see on their dashboards. These numbers are expensive to compute from MongoDB (requiring aggregation over the applications collection) but rarely need to be precisely up-to-date.

**Why Redis:** Hash fields allow individual counter increments with `HINCRBY` in O(1). The cache absorbs the aggregation cost — it can be refreshed from MongoDB on demand.

**Redis structure:** Hash  
**Key:** `listing:{listingId}:stats`  
**Fields:** `applicationCount`, `bookmarkCount`, `lastUpdated`

---

## 4. Partition Decision

| Data | Store | Reason |
|---|---|---|
| Company, JobListing, Skill | MongoDB | Durable, rarely changes |
| Applicant, Application | MongoDB | ACID-critical, official record |
| Advisor profile | MongoDB | Durable |
| Advisor bookmarks | **Redis** | High read frequency, updates constantly |
| Advisor recent views | **Redis** | Very high write frequency, ephemeral |
| Listing stats cache | **Redis** | Expensive to compute, approximate is fine |

**Conflict rule:** If MongoDB and Redis disagree on a listing's bookmark or counter value, MongoDB is correct. Redis values can be invalidated and rebuilt from MongoDB at any time.
