const state = {
  coords: { latitude: 41.8781, longitude: -87.6298 },
  place: "Chicago, Illinois",
  lastRefreshAt: null,
  nextRefreshAt: null,
  isRefreshing: false,
  forecastMode: "hourly",
  latestWeather: null,
};

const REFRESH_INTERVAL_MS = 2 * 60 * 1000;
const STALE_AFTER_MS = 90 * 1000;

const metricGrid = document.querySelector("#metricGrid");
const forecastCards = document.querySelector("#forecastCards");
const forecastMode = document.querySelector("#forecastMode");
const forecastTitle = document.querySelector("#forecastTitle");
const forecastSummary = document.querySelector("#forecastSummary");
const searchForm = document.querySelector("#searchForm");
const locationInput = document.querySelector("#locationInput");
const locateButton = document.querySelector("#locateButton");
const refreshButton = document.querySelector("#refreshButton");
const themeButton = document.querySelector("#themeButton");
const liveStatus = document.querySelector("#liveStatus");
const refreshStatus = document.querySelector("#refreshStatus");
const metarStation = document.querySelector("#metarStation");
const metarRaw = document.querySelector("#metarRaw");
const metarDetails = document.querySelector("#metarDetails");
const locationMap = document.querySelector("#locationMap");
const mapCaption = document.querySelector("#mapCaption");
const toast = document.querySelector("#toast");
let refreshTimer;
let countdownTimer;

const weatherCodes = {
  0: "Clear sky",
  1: "Mostly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Rime fog",
  51: "Light drizzle",
  53: "Drizzle",
  55: "Heavy drizzle",
  61: "Light rain",
  63: "Rain",
  65: "Heavy rain",
  71: "Light snow",
  73: "Snow",
  75: "Heavy snow",
  80: "Rain showers",
  81: "Showers",
  82: "Heavy showers",
  95: "Thunderstorm",
  96: "Thunderstorm with hail",
  99: "Severe thunderstorm",
};

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(showToast.timeout);
  showToast.timeout = window.setTimeout(() => toast.classList.remove("show"), 3400);
}

function formatTime(value) {
  return new Intl.DateTimeFormat([], {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatUpdated(value) {
  return new Intl.DateTimeFormat([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function setLoading(message = "Updating local conditions...") {
  metricGrid.innerHTML = Array.from({ length: 8 }, (_, index) => {
    const label = ["Wind", "Humidity", "Pressure", "Cloud cover"][index] || "Weather";
    return `
      <article class="metric-card">
        <div class="metric-top"><span class="metric-icon">&middot;</span></div>
        <h3>${label}</h3>
        <div class="metric-value"><strong>--</strong><span></span></div>
        <p>${message}</p>
      </article>
    `;
  }).join("");
}

async function fetchWeather(latitude, longitude, place, options = {}) {
  if (state.isRefreshing) return;
  state.isRefreshing = true;
  refreshButton.disabled = true;
  liveStatus.textContent = "Updating live data";
  refreshStatus.textContent = "Refreshing now...";

  if (!options.silent) {
    setLoading();
  }

  const params = new URLSearchParams({
    latitude,
    longitude,
    current: [
      "temperature_2m",
      "relative_humidity_2m",
      "apparent_temperature",
      "is_day",
      "precipitation",
      "weather_code",
      "cloud_cover",
      "pressure_msl",
      "surface_pressure",
      "wind_speed_10m",
      "wind_direction_10m",
      "wind_gusts_10m",
    ].join(","),
    hourly: [
      "temperature_2m",
      "precipitation_probability",
      "wind_speed_10m",
    ].join(","),
    daily: [
      "weather_code",
      "temperature_2m_max",
      "temperature_2m_min",
      "precipitation_probability_max",
      "wind_speed_10m_max",
      "sunrise",
      "sunset",
    ].join(","),
    forecast_hours: "12",
    temperature_unit: "fahrenheit",
    wind_speed_unit: "mph",
    precipitation_unit: "inch",
    timezone: "auto",
  });

  try {
    const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
    if (!response.ok) {
      const details = await response.text();
      throw new Error(details || "Weather service did not return a forecast.");
    }

    const data = await response.json();
    state.lastRefreshAt = new Date();
    state.nextRefreshAt = new Date(Date.now() + REFRESH_INTERVAL_MS);
    renderWeather(data, place);
    fetchMetar(latitude, longitude);
    scheduleLiveRefresh();
  } finally {
    state.isRefreshing = false;
    refreshButton.disabled = false;
    updateRefreshStatus();
  }
}

function renderWeather(data, place) {
  state.latestWeather = data;
  const current = data.current;
  const units = data.current_units;
  const summary = weatherCodes[current.weather_code] || "Current weather";
  const windDirection = compass(current.wind_direction_10m);
  const sunrise = data.daily?.sunrise?.[0];
  const sunset = data.daily?.sunset?.[0];

  document.querySelector("#placeName").textContent = place;
  document.querySelector("#updatedAt").textContent = `Updated ${formatUpdated(current.time)}`;
  document.querySelector("#mainTemp").textContent = Math.round(current.temperature_2m);
  document.querySelector("#feelsLike").textContent =
    `Feels like ${Math.round(current.apparent_temperature)}${units.apparent_temperature}`;
  document.querySelector("#weatherSummary").textContent = summary;
  document.querySelector("#conditionLabel").textContent = current.is_day ? "Daylight conditions" : "Night conditions";
  document.querySelector("#dayNight").textContent = current.is_day ? "Day" : "Night";
  document.querySelector("#coordinates").textContent =
    `${Number(data.latitude).toFixed(3)}, ${Number(data.longitude).toFixed(3)} | ${data.timezone_abbreviation}`;
  liveStatus.textContent = "Live updates on";
  document.documentElement.dataset.weather = weatherTheme(current.weather_code, current.is_day);
  updateLocationMap(data.latitude, data.longitude, place);

  const metrics = [
    {
      icon: "\u2197",
      label: "Wind",
      value: Math.round(current.wind_speed_10m),
      unit: units.wind_speed_10m,
      note: `${windDirection} winds with gusts near ${Math.round(current.wind_gusts_10m)} ${units.wind_gusts_10m}.`,
    },
    {
      icon: "\u2195",
      label: "Gusts",
      value: Math.round(current.wind_gusts_10m),
      unit: units.wind_gusts_10m,
      note: gustNote(current.wind_gusts_10m),
    },
    {
      icon: "%",
      label: "Humidity",
      value: Math.round(current.relative_humidity_2m),
      unit: units.relative_humidity_2m,
      note: moistureNote(current.relative_humidity_2m),
    },
    {
      icon: "\u2601",
      label: "Cloud cover",
      value: Math.round(current.cloud_cover),
      unit: units.cloud_cover,
      note: cloudNote(current.cloud_cover),
    },
    {
      icon: "in",
      label: "Precipitation",
      value: Number(current.precipitation).toFixed(2),
      unit: units.precipitation,
      note: current.precipitation > 0 ? "Measurable precipitation right now." : "No measured precipitation right now.",
    },
    {
      icon: "\u2301",
      label: "Surface pressure",
      value: Math.round(current.surface_pressure),
      unit: units.surface_pressure,
      note: "Local pressure adjusted for terrain near the forecast point.",
    },
    {
      icon: "\u2191",
      label: "Sunrise",
      value: sunrise ? formatTime(sunrise) : "--",
      unit: "",
      note: "First light timing for the selected forecast point.",
    },
    {
      icon: "\u2193",
      label: "Sunset",
      value: sunset ? formatTime(sunset) : "--",
      unit: "",
      note: "Evening light timing for the selected forecast point.",
    },
  ];

  metricGrid.innerHTML = metrics.map(renderMetricCard).join("");
  renderForecast();
  updateRefreshStatus();
}

function renderMetricCard(metric) {
  return `
    <article class="metric-card">
      <div class="metric-top">
        <span class="metric-icon" aria-hidden="true">${metric.icon}</span>
      </div>
      <h3>${metric.label}</h3>
      <div class="metric-value">
        <strong>${metric.value}</strong>
        <span>${metric.unit}</span>
      </div>
      <p>${metric.note}</p>
    </article>
  `;
}

function renderForecast() {
  if (!state.latestWeather) return;

  if (state.forecastMode === "daily") {
    renderDaily(state.latestWeather.daily, state.latestWeather.daily_units);
    return;
  }

  renderHourly(state.latestWeather.hourly, state.latestWeather.hourly_units);
}

function renderHourly(hourly, units) {
  forecastTitle.textContent = "Next few hours";
  forecastSummary.textContent = "Temperature, rain chance, and wind at a glance.";
  forecastCards.className = "forecast-cards hourly";
  forecastCards.innerHTML = hourly.time.slice(0, 8).map((time, index) => `
    <article class="hour-card">
      <time datetime="${time}">${formatTime(time)}</time>
      <strong>${Math.round(hourly.temperature_2m[index])}${units.temperature_2m}</strong>
      <span>${hourly.precipitation_probability[index]}${units.precipitation_probability} rain</span>
      <span>${Math.round(hourly.wind_speed_10m[index])} ${units.wind_speed_10m} wind</span>
    </article>
  `).join("");
}

function renderDaily(daily, units) {
  forecastTitle.textContent = "Next 7 days";
  forecastSummary.textContent = "Daily highs, lows, rain chance, and peak wind.";
  forecastCards.className = "forecast-cards daily";
  forecastCards.innerHTML = daily.time.slice(0, 7).map((date, index) => {
    const code = daily.weather_code[index];
    return `
      <article class="day-card">
        <time datetime="${date}">${formatDay(date, index)}</time>
        <strong>${Math.round(daily.temperature_2m_max[index])}${units.temperature_2m_max}</strong>
        <span>${Math.round(daily.temperature_2m_min[index])}${units.temperature_2m_min} low</span>
        <span>${daily.precipitation_probability_max[index]}${units.precipitation_probability_max} rain</span>
        <span>${Math.round(daily.wind_speed_10m_max[index])} ${units.wind_speed_10m_max} wind</span>
        <em>${weatherCodes[code] || "Forecast"}</em>
      </article>
    `;
  }).join("");
}

function formatDay(value, index) {
  if (index === 0) return "Today";
  if (index === 1) return "Tomorrow";

  return new Intl.DateTimeFormat([], {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(`${value}T12:00:00`));
}

function updateLocationMap(latitude, longitude, place) {
  const lat = Number(latitude);
  const lon = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

  const zoomMargin = 0.035;
  const bbox = [
    lon - zoomMargin,
    lat - zoomMargin,
    lon + zoomMargin,
    lat + zoomMargin,
  ].join(",");

  const params = new URLSearchParams({
    bbox,
    layer: "mapnik",
    marker: `${lat},${lon}`,
  });

  locationMap.src = `https://www.openstreetmap.org/export/embed.html?${params}`;
  mapCaption.textContent = `${place} | ${lat.toFixed(3)}, ${lon.toFixed(3)}`;
}

async function fetchMetar(latitude, longitude) {
  metarStation.textContent = "Finding nearest reporting station...";
  metarRaw.textContent = "Loading local METAR...";
  metarDetails.innerHTML = "";

  try {
    const report = await fetchLocalMetar(latitude, longitude).catch(() => fetchNwsMetar(latitude, longitude));
    renderMetar(report);
  } catch (error) {
    metarStation.textContent = "METAR unavailable";
    metarRaw.textContent =
      "The nearest station observation feed is unavailable right now.";
    metarDetails.innerHTML = "";
  }
}

async function fetchLocalMetar(latitude, longitude) {
  const response = await fetch(`/api/metar?lat=${latitude}&lon=${longitude}`);
  if (!response.ok) {
    throw new Error(await response.text() || "METAR proxy did not return a report.");
  }

  return response.json();
}

async function fetchNwsMetar(latitude, longitude) {
  const stationsResponse = await fetch(`https://api.weather.gov/points/${latitude.toFixed(4)},${longitude.toFixed(4)}/stations`);
  if (!stationsResponse.ok) {
    throw new Error("NWS station lookup did not return nearby stations.");
  }

  const stationData = await stationsResponse.json();
  const stations = stationData.features?.slice(0, 10) || [];
  let nearestObservation;

  for (const station of stations) {
    const observationResponse = await fetch(`${station.id}/observations/latest`);
    if (!observationResponse.ok) continue;

    const observationData = await observationResponse.json();
    const report = normalizeNwsObservation(station, observationData.properties, latitude, longitude);

    if (!nearestObservation) {
      nearestObservation = report;
    }

    if (report.hasRawMetar) {
      return report;
    }
  }

  if (!nearestObservation) {
    throw new Error("No nearby station observations were available.");
  }

  return nearestObservation;
}

function normalizeNwsObservation(station, observation, latitude, longitude) {
  const coords = station.geometry?.coordinates || [];
  const stationLon = Number(coords[0]);
  const stationLat = Number(coords[1]);
  const stationId = observation.stationId || station.properties?.stationIdentifier || "Station";
  const text = observation.textDescription || "Latest station observation";
  const tempF = celsiusToFahrenheit(observation.temperature?.value);
  const dewpointF = celsiusToFahrenheit(observation.dewpoint?.value);
  const windKt = kmhToKnots(observation.windSpeed?.value);
  const gustKt = kmhToKnots(observation.windGust?.value);
  const visibility = metersToMiles(observation.visibility?.value);
  const pressure = pascalsToHpa(observation.barometricPressure?.value);

  return {
    icaoId: stationId,
    stationName: observation.stationName || station.properties?.name,
    reportTime: observation.timestamp,
    rawOb: observation.rawMessage || synthesizeObservationText({
      stationId,
      text,
      tempF,
      dewpointF,
      windDirection: observation.windDirection?.value,
      windKt,
      gustKt,
      visibility,
      pressure,
    }),
    hasRawMetar: Boolean(observation.rawMessage),
    wdir: observation.windDirection?.value,
    wspd: windKt,
    wgst: gustKt,
    visib: Number.isFinite(visibility) ? visibility.toFixed(1) : "",
    altim: pressure,
    clouds: normalizeNwsClouds(observation.cloudLayers),
    lat: stationLat,
    lon: stationLon,
    distanceMiles: Number.isFinite(stationLat) && Number.isFinite(stationLon)
      ? distanceMiles(latitude, longitude, stationLat, stationLon)
      : undefined,
  };
}

function synthesizeObservationText({ stationId, text, tempF, dewpointF, windDirection, windKt, gustKt, visibility, pressure }) {
  const wind = Number.isFinite(windKt)
    ? `${Number.isFinite(windDirection) ? Math.round(windDirection) : "VRB"} degrees at ${Math.round(windKt)}${Number.isFinite(gustKt) ? ` gusting ${Math.round(gustKt)}` : ""} kt`
    : "wind unavailable";
  const temp = Number.isFinite(tempF) ? `${Math.round(tempF)}F` : "temperature unavailable";
  const dewpoint = Number.isFinite(dewpointF) ? `${Math.round(dewpointF)}F dewpoint` : "dewpoint unavailable";
  const vis = Number.isFinite(visibility) ? `${visibility.toFixed(1)} SM visibility` : "visibility unavailable";
  const altimeter = Number.isFinite(pressure) ? `${Math.round(pressure)} hPa` : "pressure unavailable";

  return `${stationId} ${text}. ${wind}; ${vis}; ${temp}; ${dewpoint}; altimeter ${altimeter}.`;
}

function renderMetar(report) {
  const observed = report.reportTime || report.receiptTime;
  const distance = Number.isFinite(report.distanceMiles) ? `${report.distanceMiles.toFixed(1)} mi away` : "nearby";
  const station = [report.icaoId || "Station", report.stationName].filter(Boolean).join(" ");
  metarStation.textContent = `${station} | ${distance} | ${observed ? formatUpdated(observed) : "latest"}`;
  metarRaw.textContent = report.rawOb || "No raw METAR text returned.";

  const details = [
    ["Wind", formatMetarWind(report)],
    ["Visibility", report.visib ? `${report.visib} SM` : "--"],
    ["Altimeter", report.altim ? `${report.altim} hPa` : "--"],
    ["Ceiling", formatClouds(report.clouds)],
  ];

  metarDetails.innerHTML = details.map(([label, value]) => `
    <div class="metar-detail">
      <span>${label}</span>
      <strong>${value}</strong>
    </div>
  `).join("");
}

function formatMetarWind(report) {
  if (!Number.isFinite(report.wspd)) return "Calm or unavailable";
  const direction = Number.isFinite(report.wdir) ? `${report.wdir}\u00b0` : "VRB";
  const gust = Number.isFinite(report.wgst) ? ` G${report.wgst}` : "";
  return `${direction} ${report.wspd}${gust} kt`;
}

function formatClouds(clouds) {
  if (!Array.isArray(clouds) || clouds.length === 0) return "Clear";
  const ceiling = clouds.find((cloud) => cloud.cover && cloud.cover !== "CLR");
  if (!ceiling) return "Clear";
  return `${ceiling.cover}${ceiling.base ? ` ${ceiling.base} ft` : ""}`;
}

function normalizeNwsClouds(cloudLayers) {
  if (!Array.isArray(cloudLayers) || cloudLayers.length === 0) return [];

  return cloudLayers.map((layer) => ({
    cover: layer.amount,
    base: Number.isFinite(layer.base?.value) ? Math.round(layer.base.value * 3.28084) : undefined,
  }));
}

function compass(degrees) {
  const directions = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return directions[Math.round(degrees / 45) % 8];
}

function celsiusToFahrenheit(value) {
  return Number.isFinite(value) ? (value * 9) / 5 + 32 : undefined;
}

function kmhToKnots(value) {
  return Number.isFinite(value) ? value / 1.852 : undefined;
}

function metersToMiles(value) {
  return Number.isFinite(value) ? value / 1609.344 : undefined;
}

function pascalsToHpa(value) {
  return Number.isFinite(value) ? value / 100 : undefined;
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

function moistureNote(humidity) {
  if (humidity >= 70) return "Air feels damp; evaporation will be slower.";
  if (humidity <= 35) return "Air is dry; hydration and static can be noticeable.";
  return "Comfortable moisture range for most outdoor activity.";
}

function cloudNote(cloudCover) {
  if (cloudCover >= 75) return "Mostly covered sky.";
  if (cloudCover >= 35) return "Mixed sun and clouds.";
  return "Open sky dominates.";
}

function gustNote(gust) {
  if (gust >= 35) return "Strong gusts; secure loose outdoor items.";
  if (gust >= 20) return "Breezy at times.";
  return "Gusts are fairly light.";
}

function weatherTheme(code, isDay) {
  if (!isDay) return "night";
  if ([45, 48].includes(code)) return "fog";
  if ([71, 73, 75].includes(code)) return "snow";
  if ([95, 96, 99].includes(code)) return "storm";
  if ([51, 53, 55, 61, 63, 65, 80, 81, 82].includes(code)) return "rain";
  if ([2, 3].includes(code)) return "cloud";
  return "clear";
}

async function searchLocation(query) {
  const params = new URLSearchParams({
    name: query,
    count: "1",
    language: "en",
    format: "json",
  });
  const response = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${params}`);
  if (!response.ok) throw new Error("Location lookup failed.");

  const data = await response.json();
  const match = data.results?.[0];
  if (!match) throw new Error("No matching city or ZIP code found.");

  const label = [match.name, match.admin1, match.country].filter(Boolean).join(", ");
  state.coords = { latitude: match.latitude, longitude: match.longitude };
  state.place = label;
  await fetchWeather(match.latitude, match.longitude, label);
}

function locate() {
  if (!navigator.geolocation) {
    showToast("Location is not available in this browser. Showing Chicago by default.");
    refreshNow({ silent: false });
    return;
  }

  navigator.geolocation.getCurrentPosition(
    async (position) => {
      const { latitude, longitude } = position.coords;
      state.coords = { latitude, longitude };
      state.place = "Your current location";
      try {
        await fetchWeather(latitude, longitude, state.place);
      } catch (error) {
        showToast(error.message);
      }
    },
    () => {
      showToast("Location permission was not granted. Showing Chicago by default.");
      refreshNow({ silent: false });
    },
    { enableHighAccuracy: true, timeout: 9000, maximumAge: 600000 },
  );
}

function refreshNow(options = {}) {
  return fetchWeather(state.coords.latitude, state.coords.longitude, state.place, {
    silent: options.silent ?? true,
  }).catch((error) => {
    liveStatus.textContent = "Live updates delayed";
    refreshStatus.textContent = "Last refresh failed. Retrying soon.";
    showToast(error.message);
    scheduleLiveRefresh(60 * 1000);
  });
}

function scheduleLiveRefresh(delay = REFRESH_INTERVAL_MS) {
  window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(() => {
    refreshNow({ silent: true });
  }, delay);
}

function startCountdown() {
  window.clearInterval(countdownTimer);
  countdownTimer = window.setInterval(updateRefreshStatus, 1000);
}

function updateRefreshStatus() {
  if (!state.nextRefreshAt) {
    refreshStatus.textContent = "Next refresh pending...";
    return;
  }

  const seconds = Math.max(0, Math.ceil((state.nextRefreshAt.getTime() - Date.now()) / 1000));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  const next = minutes > 0 ? `${minutes}m ${String(remainder).padStart(2, "0")}s` : `${remainder}s`;
  const last = state.lastRefreshAt ? formatTime(state.lastRefreshAt) : "just now";

  refreshStatus.textContent = `Last live update ${last}. Next in ${next}.`;
}

function getInitialTheme() {
  const savedTheme = window.localStorage.getItem("weather-theme");
  if (savedTheme === "dark" || savedTheme === "light") {
    return savedTheme;
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  themeButton.textContent = theme === "dark" ? "\u2600" : "\u263e";
  themeButton.setAttribute("aria-pressed", String(theme === "dark"));
  themeButton.setAttribute("aria-label", theme === "dark" ? "Switch to light mode" : "Switch to dark mode");
}

function toggleTheme() {
  const nextTheme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  window.localStorage.setItem("weather-theme", nextTheme);
  applyTheme(nextTheme);
}

searchForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const query = locationInput.value.trim();
  if (!query) return;

  try {
    await searchLocation(query);
  } catch (error) {
    showToast(error.message);
  }
});

locateButton.addEventListener("click", locate);
refreshButton.addEventListener("click", () => refreshNow({ silent: false }));
themeButton.addEventListener("click", toggleTheme);
forecastMode.addEventListener("change", () => {
  state.forecastMode = forecastMode.value;
  renderForecast();
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden || !state.lastRefreshAt) return;

  const isStale = Date.now() - state.lastRefreshAt.getTime() > STALE_AFTER_MS;
  if (isStale) {
    refreshNow({ silent: true });
  }
});

applyTheme(getInitialTheme());
startCountdown();
locate();
