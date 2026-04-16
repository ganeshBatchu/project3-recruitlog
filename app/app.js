const express = require("express");
const path = require("path");
const methodOverride = require("method-override");
const redis = require("./db/redisClient");

const indexRouter = require("./routes/index");

const app = express();
const PORT = process.env.PORT || 3000;

// View engine
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(methodOverride("_method"));
app.use(express.static(path.join(__dirname, "public")));

// Routes
app.use("/", indexRouter);

// 404 handler
app.use((req, res) => {
  res.status(404).render("error", { title: "Not Found", message: "Page not found." });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render("error", { title: "Server Error", message: err.message });
});

async function start() {
  await redis.connect();
  app.listen(PORT, () => {
    console.log(`Recruit.log (Redis) running at http://localhost:${PORT}`);
  });
}

start().catch(console.error);
