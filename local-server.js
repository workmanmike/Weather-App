const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const port = Number(process.env.PORT || 5173);
const root = __dirname;

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

const server = http.createServer((request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  if (url.pathname === "/api/metar") {
    handleMetarRequest(url, response);
    return;
  }

  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.join(root, path.normalize(pathname));

  if (!filePath.startsWith(root)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }

    response.writeHead(200, {
      "Content-Type": types[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    response.end(data);
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Weather app running at http://127.0.0.1:${port}/`);
});

async function handleMetarRequest(url, response) {
  const latitude = Number(url.searchParams.get("lat"));
  const longitude = Number(url.searchParams.get("lon"));

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    sendText(response, 400, "Latitude and longitude are required.");
    return;
  }

  try {
    const reports = await fetchNearbyMetars(latitude, longitude);
    if (reports.length === 0) {
      sendText(response, 404, "No nearby METAR reports were found.");
      return;
    }

    const nearest = reports
      .filter((report) => Number.isFinite(report.lat) && Number.isFinite(report.lon))
      .map((report) => ({
        ...report,
        distanceMiles: distanceMiles(latitude, longitude, report.lat, report.lon),
      }))
      .sort((a, b) => a.distanceMiles - b.distanceMiles)[0];

    if (!nearest) {
      sendText(response, 404, "Nearby METAR reports did not include station coordinates.");
      return;
    }

    response.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(JSON.stringify(nearest));
  } catch (error) {
    sendText(response, 502, "Unable to load the Aviation Weather Center METAR feed.");
  }
}

async function fetchNearbyMetars(latitude, longitude) {
  const searchRadii = [0.5, 1, 2, 4];

  for (const radius of searchRadii) {
    const params = new URLSearchParams({
      bbox: [
        latitude - radius,
        longitude - radius,
        latitude + radius,
        longitude + radius,
      ].join(","),
      format: "json",
    });

    const apiUrl = `https://aviationweather.gov/api/data/metar?${params}`;
    const apiResponse = await fetch(apiUrl, {
      headers: {
        "User-Agent": "Weather-App local dashboard",
      },
    });

    if (apiResponse.status === 204) continue;
    if (!apiResponse.ok) throw new Error(`METAR API returned ${apiResponse.status}`);

    const reports = await apiResponse.json();
    if (Array.isArray(reports) && reports.length > 0) {
      return reports;
    }
  }

  return [];
}

function distanceMiles(lat1, lon1, lat2, lon2) {
  const earthRadiusMiles = 3958.8;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;

  return 2 * earthRadiusMiles * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRadians(degrees) {
  return degrees * (Math.PI / 180);
}

function sendText(response, status, message) {
  response.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(message);
}
