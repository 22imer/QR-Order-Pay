import http from 'k6/http';
import ws from 'k6/ws';
import { check } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';
import { freshTableToken } from './table-qr.js';

const baseUrl = __ENV.BASE_URL || 'http://web:8080';
const wsUrl = baseUrl.replace(/^http/, 'ws');
const holdMs = Number(__ENV.HOLD_MS || 30000);
export const socketErrors = new Rate('socket_errors');
export const socketConnected = new Counter('socket_connected');
export const socketConnectMs = new Trend('socket_connect_ms', true);

export const options = {
  scenarios: {
    realtime_connections: {
      executor: 'per-vu-iterations',
      vus: Number(__ENV.CONNECTIONS || 100),
      iterations: 1,
      maxDuration: __ENV.MAX_DURATION || '60s',
    },
  },
  thresholds: {
    socket_errors: ['rate<0.01'],
    socket_connect_ms: ['p(95)<2000'],
  },
};

export default function () {
  const tableToken = freshTableToken(baseUrl);
  const joined = http.post(
    `${baseUrl}/api/v1/table-sessions/join`,
    JSON.stringify({ tableToken }),
    {
      headers: { 'Content-Type': 'application/json' },
    },
  );
  const cookie =
    joined.cookies.mc_guest && joined.cookies.mc_guest[0] && joined.cookies.mc_guest[0].value;
  if (!cookie) {
    socketErrors.add(true);
    return;
  }
  const startedAt = Date.now();
  let authenticated = false;
  const response = ws.connect(
    `${wsUrl}/socket.io/?EIO=4&transport=websocket`,
    { headers: { Cookie: `mc_guest=${cookie}` } },
    (socket) => {
      socket.on('message', (message) => {
        if (message[0] === '0') socket.send('40{"role":"GUEST"}');
        else if (message.startsWith('40')) {
          authenticated = true;
          socketConnected.add(1);
          socketConnectMs.add(Date.now() - startedAt);
        } else if (message === '2') socket.send('3');
      });
      socket.setTimeout(() => socket.close(), holdMs);
    },
  );
  const ok =
    check(response, { 'websocket upgraded': (value) => value && value.status === 101 }) &&
    authenticated;
  socketErrors.add(!ok);
}
