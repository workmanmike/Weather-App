const state = {
  coords: { latitude: 41.8781, longitude: -87.6298 },
  place: "Chicago, Illinois",
  lastRefreshAt: null,
  nextRefreshAt: null,
  isRefreshing: false,
};

const REFRESH_INTERVAL_MS = 2 * 60 * 1000;
const STALE_AFTER_MS = 90 * 1000;

const metricGrid = document.querySelector("#metricGrid");
const hourlyForecast = document.querySelector("#hourlyForecast");
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
    const label = ["Temperature", "Wind", "Humidity", "Pressure"][index] || "Weather";
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
    daily: "sunrise,sunset",
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

  const metrics = [
    {
      icon: "\u00b0",
      label: "Temperature",
      value: Math.round(current.temperature_2m),
      unit: units.temperature_2m,
      note: `${summary}; apparent temperature ${Math.round(current.apparent_temperature)}${units.apparent_temperature}.`,
    },
    {
      icon: "\u2197",
      label: "Wind",
      value: Math.round(current.wind_speed_10m),
      unit: units.wind_speed_10m,
      note: `${windDirection} winds with gusts near ${Math.round(current.wind_gusts_10m)} ${units.wind_gusts_10m}.`,
    },
    {
      icon: "%",
      label: "Humidity",
      value: Math.round(current.relative_humidity_2m),
      unit: units.relative_humidity_2m,
      note: moistureNote(current.relative_humidity_2m),
    },
    {
      icon: "P",
      label: "Sea level pressure",
      value: Math.round(current.pressure_msl),
      unit: units.pressure_msl,
      note: `Surface pressure is ${Math.round(current.surface_pressure)} ${units.surface_pressure}.`,
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
      icon: "\u2195",
      label: "Gusts",
      value: Math.round(current.wind_gusts_10m),
      unit: units.wind_gusts_10m,
      note: gustNote(current.wind_gusts_10m),
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
  renderHourly(data.hourly, data.hourly_units);
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

function renderHourly(hourly, units) {
  hourlyForecast.innerHTML = hourly.time.slice(0, 8).map((time, index) => `
    <article class="hour-card">
      <time datetime="${time}">${formatTime(time)}</time>
      <strong>${Math.round(hourly.temperature_2m[index])}${units.temperature_2m}</strong>
      <span>${hourly.precipitation_probability[index]}${units.precipitation_probability} rain</span>
      <span>${Math.round(hourly.wind_speed_10m[index])} ${units.wind_speed_10m} wind</span>
    </article>
  `).join("");
}

async function fetchMetar(latitude, longitude) {
  metarStation.textContent = "Finding nearest reporting station...";
  metarRaw.textContent = "Loading local METAR...";
  metarDetails.innerHTML = "";

  try {
    const response = await fetch(`/api/metar?lat=${latitude}&lon=${longitude}`);
    if (!response.ok) {
      throw new Error(await response.text() || "METAR feed did not return a report.");
    }

    const report = await response.json();
    renderMetar(report);
  } catch (error) {
    metarStation.textContent = "METAR unavailable";
    metarRaw.textContent =
      "Start the local Node server to enable METAR reports, or try again once the aviation feed is available.";
    metarDetails.innerHTML = "";
  }
}

function renderMetar(report) {
  const observed = report.reportTime || report.receiptTime;
  const distance = Number.isFinite(report.distanceMiles) ? `${report.distanceMiles.toFixed(1)} mi away` : "nearby";
  metarStation.textContent = `${report.icaoId || "Station"} | ${distance} | ${observed ? formatUpdated(observed) : "latest"}`;
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

function compass(degrees) {
  const directions = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return directions[Math.round(degrees / 45) % 8];
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
