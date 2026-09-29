let map;
let selectedStation = null;
let sessionId = null;
let progress = 0;
let chargingInterval;
const markers = new Map(); // station id -> marker, so panning doesn't redraw existing ones

async function fetchStationsData(bounds) {
  const ne = bounds.getNorthEast();
  const sw = bounds.getSouthWest();
  const params = new URLSearchParams({
    minLat: sw.lat(),
    maxLat: ne.lat(),
    minLng: sw.lng(),
    maxLng: ne.lng(),
  });

  try {
    const response = await fetch(`http://localhost:3000/stations?${params}`);
    const stations = await response.json();
    console.log("fetched stations:", stations);
    return stations;
  } catch (error) {
    console.error("error fetching stations", error);
    return [];
  }
}

function initMap() {
  const mapLook = {
    zoom: 15,
    center: { lat: 51.509865, lng: -0.118092 },
  };

  map = new google.maps.Map(document.getElementById("map"), mapLook);

  markers.clear();

  // Load the stations in view whenever the user stops panning or zooming
  map.addListener("idle", () => {
    fetchStationsData(map.getBounds()).then((stations) => {
      stations.forEach((station) => {
        if (!markers.has(station.id)) placeMarker(station);
      });
    });
  });
}

function placeMarker(station) {
  const lat = parseFloat(station.latitude);
  const lng = parseFloat(station.longitude);
  const power = station.power_kw ? `${parseFloat(station.power_kw)} kW` : "unknown";
  const address = [station.address, station.town, station.postcode].filter(Boolean).join(", ");

  const marker = new google.maps.Marker({
    position: { lat: lat, lng: lng },
    map: map,
    title: station.station_name,
  });

  const infowindow = new google.maps.InfoWindow({
    content: `
        <h3>${station.station_name}</h3>
        <p>Address: ${address}</p>
        <p>Connectors: ${station.connector_type || "unknown"}</p>
        <p>Max power: ${power}</p>
        `,
  });
  markers.set(station.id, marker);

  marker.addListener("click", () => {
    infowindow.open(map, marker);

    selectedStation = station;
    document.getElementById("session-buttons").style.display = "block";
    document.getElementById("start-charging").disabled = false;
    console.log(`Selected station: ${station.station_name}`);
  });
}

async function startCharging() {
  progress = 0;

  document.getElementById("charging-progress").style.display = "block";

  chargingInterval = setInterval(() => {
    if (progress < 100) {
      progress += 0.5;
      updateChargingProgress(progress);
    } else {
      clearInterval(chargingInterval);
    }
  }, 1000);

  function updateChargingProgress(progress) {
    document.getElementById("progress-bar").value = progress;

    document.getElementById(
      "progress-text"
    ).innerText = `${progress}% Charging`;
  }

  if (!selectedStation) {
    console.error("No station selected");
    return;
  }
  console.log("Starting session for station:", selectedStation);
  try {
    const response = await fetch(
      "http://localhost:3000/sessions/start-charging",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ station_id: selectedStation.id, user_id: 1 }),
      }
    );
    const data = await response.json();
    sessionId = data.session_id;
    console.log(`Charging session started. Session ID: ${sessionId}`);
    document.getElementById("start-charging").disabled = true;
    document.getElementById("complete-charging").disabled = false;
  } catch (error) {
    console.error("Error starting session:", error);
  }
}

async function completeCharging() {
  if (!sessionId) return;

  clearInterval(chargingInterval);

  progress = Math.min(progress, 100);
  document.getElementById("progress-bar").value = progress;
  document.getElementById("progress-text").innerText = `${progress.toFixed(
    1
  )}% Charging`;

  try {
    const response = await fetch(
      "http://localhost:3000/sessions/complete-charging",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId }),
      }
    );
    const data = await response.json();
    console.log(`Session completed. Cost: ${data.total_cost}`);
    document.getElementById("complete-charging").disabled = true;
    document.getElementById("payment-button").style.display = "block";
    //alert(`Session completed. Total Cost: ${data.total_cost}`);
  } catch (error) {
    console.error("Error completing session:", error);
  }
}

async function proceedToPayment() {
  if (!sessionId) {
    alert("No session found!");
    return;
  }

  try {
    const costResponse = await fetch(
      `http://localhost:3000/sessions/get-cost`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId }),
      }
    );

    const costData = await costResponse.json();
    if (costData.error) {
      alert("Failed to fetch cost: " + costData.error);
      return;
    }

    const totalCost = costData.total_cost;
    console.log(`Total cost for session: ${totalCost}`);

    const encodedCost = encodeURIComponent(totalCost);

    window.location.href = `payment.html?cost=${encodedCost}`;
  } catch (error) {
    console.error("Error during payment process:", error);
  }
}
