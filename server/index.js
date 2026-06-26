import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { Server as SocketIOServer } from 'socket.io';
import { verifyToken } from '@clerk/backend';
import routes from './routes/index.js';
import { getRealtimeUserRoom, setRealtimeServer } from './lib/realtime.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT);

const app = express();
app.use(cors());
app.use(express.json());
const uploadsStaticRoot = path.join(__dirname, 'uploads');
app.use('/uploads', express.static(uploadsStaticRoot));
// When the file is missing, express.static calls next() and the global JSON 404 hid the real issue.
app.use('/uploads', (req, res) => {
  res.status(404).json({
    error: 'Upload not found on server',
    path: req.originalUrl,
    hint: 'The file is not under server/uploads on this host, or the deploy wiped the uploads folder. Re-upload the image after ensuring uploads/ is persisted.',
  });
});

const ANDROID_PLAY_STORE_SEARCH_URL = 'https://play.google.com/store/apps/details?id=com.tatenda10.trustexpress';
const IOS_APP_STORE_SEARCH_URL = 'https://apps.apple.com/gr/app/trust-express-app/id6760766112';

function buildInviteLandingHtml({ title, appDeepLink, openLabel }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    body { font-family: system-ui, sans-serif; padding: 24px; max-width: 420px; margin: 0 auto; }
    p { color: #444; line-height: 1.5; }
    a { color: #16213a; font-weight: 600; }
  </style>
</head>
<body>
  <p>Opening Trust Express...</p>
  <p>If nothing happens, <a id="store-link" href="${ANDROID_PLAY_STORE_SEARCH_URL.replace(/"/g, '&quot;')}">get the app</a>.</p>
  <p><a href="${appDeepLink.replace(/"/g, '&quot;')}">${openLabel}</a></p>
  <script>
(function () {
  var appUrl = ${JSON.stringify(appDeepLink)};
  var androidStoreUrl = ${JSON.stringify(ANDROID_PLAY_STORE_SEARCH_URL)};
  var iosStoreUrl = ${JSON.stringify(IOS_APP_STORE_SEARCH_URL)};
  var ua = window.navigator.userAgent || '';
  var isApple = /iPhone|iPad|iPod/i.test(ua);
  var storeUrl = isApple ? iosStoreUrl : androidStoreUrl;
  var storeLink = document.getElementById('store-link');
  if (storeLink) {
    storeLink.href = storeUrl;
    storeLink.textContent = isApple ? 'get the app from the App Store' : 'get the app from Google Play';
  }
  var left = false;
  function markLeft() { left = true; }
  window.addEventListener('pagehide', markLeft);
  window.addEventListener('blur', markLeft);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') markLeft();
  });
  window.location.href = appUrl;
  setTimeout(function () {
    if (!left && document.visibilityState === 'visible') {
      window.location.replace(storeUrl);
    }
  }, 2800);
})();
  </script>
</body>
</html>`;
}

function handleInviteLanding(req, res, type) {
  const invite = String(req.query.invite || '').trim();
  if (!invite || invite.length > 200 || !/^[a-zA-Z0-9_-]+$/.test(invite)) {
    res.status(400).send('Invalid invite token');
    return;
  }

  const path = type === 'passenger' ? 'passenger-signup' : 'driver-signup';
  const title = type === 'passenger' ? 'Trust Express - Passenger invite' : 'Trust Express - Driver invite';
  const openLabel = type === 'passenger' ? 'Open passenger signup in app' : 'Open driver signup in app';
  const appDeepLink = `trustexpress://${path}?invite=${encodeURIComponent(invite)}`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(buildInviteLandingHtml({ title, appDeepLink, openLabel }));
}

// HTTPS landing pages for QR scans and shared links. These try the app first,
// then send the user to the right store for their device if the app did not open.
app.get('/invite/driver', (req, res) => {
  handleInviteLanding(req, res, 'driver');
});

app.get('/invite/passenger', (req, res) => {
  handleInviteLanding(req, res, 'passenger');
});

app.get('/driver-signup', (req, res) => {
  handleInviteLanding(req, res, 'driver');
});

app.get('/passenger-signup', (req, res) => {
  handleInviteLanding(req, res, 'passenger');
});

app.use('/api', routes);

app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Server error' });
});

const httpServer = http.createServer(app);
// Give mobile clients more breathing room on slower networks and larger uploads.
httpServer.requestTimeout = 120000;
httpServer.headersTimeout = 125000;
httpServer.keepAliveTimeout = 65000;

const io = new SocketIOServer(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

io.use(async (socket, next) => {
  try {
    const token = String(socket.handshake.auth?.token || socket.handshake.headers?.authorization || '').replace(/^Bearer\s+/i, '').trim();
    if (!token) {
      return next(new Error('Missing socket auth token'));
    }

    const payload = await verifyToken(token, {
      secretKey: process.env.CLERK_SECRET_KEY,
    });

    socket.data.userId = payload.sub;
    return next();
  } catch {
    return next(new Error('Invalid or expired socket token'));
  }
});

io.on('connection', (socket) => {
  const userId = socket.data.userId;
  if (!userId) {
    socket.disconnect(true);
    return;
  }

  socket.join(getRealtimeUserRoom(userId));
});

setRealtimeServer(io);

httpServer.listen(PORT, () => {
  console.log(`Trust Express API at http://localhost:${PORT}`);
});
