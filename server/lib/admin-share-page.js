export function buildAuthorityShareTrackingHtml({ token, apiPath }) {
  const safeToken = String(token || '').replace(/[<>&"']/g, '');
  const safeApiPath = String(apiPath || '').replace(/[<>&"']/g, '');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="robots" content="noindex,nofollow" />
  <title>Trust Express · Live trip share</title>
  <link rel="stylesheet" href="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css" />
  <style>
    :root {
      --bg: #0b1220;
      --card: #111827;
      --line: #1f2937;
      --text: #f8fafc;
      --muted: #94a3b8;
      --accent: #2563eb;
      --ok: #10b981;
      --warn: #f59e0b;
      --danger: #f43f5e;
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; height: 100%; background: var(--bg); color: var(--text); font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif; }
    body { display: flex; flex-direction: column; }
    header {
      padding: 14px 16px 12px;
      border-bottom: 1px solid var(--line);
      background: linear-gradient(180deg, #111827 0%, #0b1220 100%);
    }
    .eyebrow { font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--muted); margin: 0 0 6px; }
    h1 { margin: 0; font-size: 18px; font-weight: 700; }
    .status-row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; align-items: center; }
    .badge {
      display: inline-flex; align-items: center; gap: 6px;
      border-radius: 999px; padding: 4px 10px; font-size: 12px; font-weight: 600;
      background: #1e293b; color: #e2e8f0;
    }
    .badge.live { background: rgba(16,185,129,0.15); color: #6ee7b7; }
    .badge.ended { background: rgba(244,63,94,0.15); color: #fda4af; }
    #map { flex: 1; min-height: 280px; }
    .panel {
      border-top: 1px solid var(--line);
      background: var(--card);
      padding: 14px 16px 18px;
      max-height: 42vh;
      overflow: auto;
    }
    .grid { display: grid; gap: 10px; grid-template-columns: 1fr 1fr; }
    .field { background: #0f172a; border: 1px solid var(--line); border-radius: 12px; padding: 10px 12px; }
    .field.wide { grid-column: 1 / -1; }
    .label { margin: 0; font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); }
    .value { margin: 6px 0 0; font-size: 14px; font-weight: 600; word-break: break-word; }
    .muted { color: var(--muted); font-weight: 500; font-size: 12px; }
    .error {
      margin: 24px auto; max-width: 420px; padding: 18px;
      border: 1px solid rgba(244,63,94,0.35); background: rgba(244,63,94,0.08);
      border-radius: 14px; color: #fecdd3; text-align: center;
    }
    .marker {
      width: 14px; height: 14px; border-radius: 999px; border: 2px solid #fff;
      box-shadow: 0 0 0 2px rgba(15,23,42,0.35);
    }
    .marker.driver { background: var(--accent); width: 16px; height: 16px; }
    .marker.pickup { background: #111827; }
    .marker.dropoff { background: var(--ok); }
    .marker.stop { background: var(--warn); }
    @media (max-width: 640px) {
      .grid { grid-template-columns: 1fr; }
      .panel { max-height: 48vh; }
    }
  </style>
</head>
<body>
  <header>
    <p class="eyebrow">Trust Express · Authority live share</p>
    <h1 id="title">Loading trip…</h1>
    <div class="status-row">
      <span id="stage-badge" class="badge">Connecting</span>
      <span id="refresh-label" class="muted">Waiting for first update</span>
    </div>
  </header>
  <div id="map"></div>
  <section class="panel" id="panel" hidden>
    <div class="grid">
      <div class="field"><p class="label">Driver</p><p class="value" id="driver-name">-</p></div>
      <div class="field"><p class="label">Driver phone</p><p class="value" id="driver-phone">-</p></div>
      <div class="field"><p class="label">Passenger</p><p class="value" id="passenger-name">-</p></div>
      <div class="field"><p class="label">Passenger phone</p><p class="value" id="passenger-phone">-</p></div>
      <div class="field wide"><p class="label">Vehicle</p><p class="value" id="vehicle">-</p></div>
      <div class="field wide"><p class="label">Pickup</p><p class="value" id="pickup">-</p></div>
      <div class="field wide"><p class="label">Drop-off</p><p class="value" id="dropoff">-</p></div>
      <div class="field wide"><p class="label">Current target</p><p class="value" id="target">-</p></div>
      <div class="field wide"><p class="label">Last driver update</p><p class="value" id="last-seen">-</p></div>
    </div>
  </section>
  <div id="error" class="error" hidden></div>

  <script src="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"></script>
  <script>
(function () {
  var TOKEN = ${JSON.stringify(safeToken)};
  var API_PATH = ${JSON.stringify(safeApiPath)};
  var POLL_MS = 5000;
  var map = null;
  var markers = {};
  var fittedOnce = false;

  var OSM_STYLE = {
    version: 8,
    sources: {
      osm: {
        type: 'raster',
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        attribution: '&copy; OpenStreetMap contributors'
      }
    },
    layers: [{ id: 'osm', type: 'raster', source: 'osm' }]
  };

  function el(id) { return document.getElementById(id); }
  function text(id, value) { el(id).textContent = value || '-'; }
  function formatTime(value) {
    if (!value) return '-';
    try { return new Date(value).toLocaleString(); } catch (e) { return String(value); }
  }

  function ensureMap(center) {
    if (map) return map;
    map = new maplibregl.Map({
      container: 'map',
      style: OSM_STYLE,
      center: center || [28.581, -20.1596],
      zoom: 13
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    return map;
  }

  function setMarker(id, lngLat, className, title) {
    if (!lngLat) {
      if (markers[id]) {
        markers[id].remove();
        delete markers[id];
      }
      return;
    }
    if (!markers[id]) {
      var node = document.createElement('div');
      node.className = 'marker ' + className;
      node.title = title || '';
      markers[id] = new maplibregl.Marker({ element: node }).setLngLat(lngLat).addTo(map);
    } else {
      markers[id].setLngLat(lngLat);
    }
  }

  function fitIfNeeded(points) {
    if (fittedOnce || !points.length) return;
    var bounds = new maplibregl.LngLatBounds(points[0], points[0]);
    points.forEach(function (point) { bounds.extend(point); });
    map.fitBounds(bounds, { padding: 56, maxZoom: 15, duration: 600 });
    fittedOnce = true;
  }

  function showError(message) {
    el('panel').hidden = true;
    el('map').style.display = 'none';
    el('error').hidden = false;
    el('error').textContent = message || 'Unable to load this shared trip.';
    el('title').textContent = 'Share unavailable';
    el('stage-badge').textContent = 'Unavailable';
    el('stage-badge').className = 'badge ended';
  }

  function render(payload) {
    var trip = payload.trip || {};
    el('error').hidden = true;
    el('panel').hidden = false;
    el('map').style.display = 'block';
    el('title').textContent = trip.publicId ? ('Trip ' + trip.publicId) : 'Live trip';

    var badge = el('stage-badge');
    badge.textContent = trip.stage || trip.status || 'Unknown';
    badge.className = 'badge ' + (trip.isLive ? 'live' : 'ended');
    el('refresh-label').textContent = 'Updated ' + formatTime(trip.refreshedAt);

    text('driver-name', trip.driverName);
    text('driver-phone', trip.driverPhone);
    text('passenger-name', trip.passengerName);
    text('passenger-phone', trip.passengerPhone);
    text('vehicle', (trip.vehicle && trip.vehicle.label) || '-');
    text('pickup', trip.pickupLabel);
    text('dropoff', trip.dropoffLabel);
    text('target', trip.currentTargetLabel);
    text('last-seen', formatTime(trip.driverLastSeenAt));

    var driver = trip.driverCoordinate;
    var pickup = trip.pickupCoordinate;
    var dropoff = trip.dropoffCoordinate;
    var center = driver || pickup || dropoff;
    ensureMap(center ? [center.lng, center.lat] : null);

    setMarker('driver', driver ? [driver.lng, driver.lat] : null, 'driver', 'Driver');
    setMarker('pickup', pickup ? [pickup.lng, pickup.lat] : null, 'pickup', 'Pickup');
    setMarker('dropoff', dropoff ? [dropoff.lng, dropoff.lat] : null, 'dropoff', 'Drop-off');

    var points = [];
    if (driver) points.push([driver.lng, driver.lat]);
    if (pickup) points.push([pickup.lng, pickup.lat]);
    if (dropoff) points.push([dropoff.lng, dropoff.lat]);
    fitIfNeeded(points);

    if (driver && fittedOnce) {
      map.easeTo({ center: [driver.lng, driver.lat], duration: 700 });
    }
  }

  async function refresh() {
    try {
      var response = await fetch(API_PATH + '?t=' + Date.now(), { cache: 'no-store' });
      var data = await response.json().catch(function () { return {}; });
      if (!response.ok) {
        showError(data.error || ('Could not load shared trip (' + response.status + ')'));
        return;
      }
      render(data);
    } catch (err) {
      showError('Network error while loading the shared trip.');
    }
  }

  refresh();
  setInterval(refresh, POLL_MS);
})();
  </script>
</body>
</html>`;
}
