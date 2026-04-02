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
const PORT = Number(process.env.PORT) || 3001;

const app = express();
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
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
