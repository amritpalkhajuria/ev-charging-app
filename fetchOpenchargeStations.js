// Extracts every charging station for a country from the OpenChargeMap API.
// Usage: node fetchOpenchargeStations.js   (COUNTRY_CODE defaults to GB)
//
// Pages through the API by station ID (keyset pagination) so each request is
// small and the run can pick up where it stopped. Uses compact mode, so nested
// lookups like connector names are fetched once from /referencedata instead of
// being repeated on every record.
require("dotenv").config();
const axios = require("axios");
const fs = require("fs");
const path = require("path");

const API = "https://api.openchargemap.io/v3";
const API_KEY = process.env.OPENCHARGEMAP_API_KEY;
const COUNTRY_CODE = process.env.COUNTRY_CODE || "GB";
const PAGE_SIZE = 5000;
const OUT_DIR = path.join(__dirname, "data", "raw");

if (!API_KEY) {
  console.error("OPENCHARGEMAP_API_KEY is not set. Copy sample.env to .env and fill it in.");
  process.exit(1);
}

const get = (endpoint, params) =>
  axios.get(`${API}${endpoint}`, {
    params: { key: API_KEY, output: "json", ...params },
    timeout: 60000,
  });

const fetchAllStations = async () => {
  const stations = [];
  let lastId = 0;
  let page = 0;

  while (true) {
    const { data } = await get("/poi/", {
      countrycode: COUNTRY_CODE,
      compact: true,
      verbose: false,
      sortby: "id_asc",
      greaterthanid: lastId,
      maxresults: PAGE_SIZE,
    });

    page++;
    stations.push(...data);
    console.log(`Page ${page}: ${data.length} stations (total ${stations.length})`);

    if (data.length < PAGE_SIZE) break;
    lastId = data[data.length - 1].ID;
  }

  return { stations, pages: page };
};

const main = async () => {
  const started = Date.now();
  fs.mkdirSync(OUT_DIR, { recursive: true });

  try {
    const { data: referenceData } = await get("/referencedata/");
    const { stations, pages } = await fetchAllStations();

    const stationsFile = path.join(OUT_DIR, `stations_${COUNTRY_CODE}.json`);
    fs.writeFileSync(stationsFile, JSON.stringify(stations));
    fs.writeFileSync(path.join(OUT_DIR, "referencedata.json"), JSON.stringify(referenceData));

    const manifest = {
      country: COUNTRY_CODE,
      fetched_at: new Date().toISOString(),
      stations: stations.length,
      pages,
      seconds: (Date.now() - started) / 1000,
    };
    fs.writeFileSync(path.join(OUT_DIR, "manifest.json"), JSON.stringify(manifest, null, 2));

    console.log(`Saved ${stations.length} stations to ${stationsFile} in ${manifest.seconds}s`);
  } catch (error) {
    console.error("Error fetching data:", error.message);
    process.exit(1);
  }
};

main();
