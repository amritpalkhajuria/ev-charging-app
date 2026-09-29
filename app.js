require("dotenv").config();
const express = require("express");
const path = require("path");
const bodyParser = require("body-parser");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname)));

const fetchingStationsRouter = require("./fetching_stations");
const manageSessionsRouter = require("./managing_sessions");

app.use("/stations", fetchingStationsRouter);
app.use("/sessions", manageSessionsRouter);

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "landingpage.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

module.exports = app;
