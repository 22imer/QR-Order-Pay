import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';
import { freshTableToken } from './table-qr.js';

const baseUrl = __ENV.BASE_URL || 'http://web:8080';
export const unexpectedErrors = new Rate('unexpected_errors');
let joined = false;
let guestCookie = '';

export const options = {
  scenarios: {
    guest_flow: {
      executor: 'constant-vus',
      vus: Number(__ENV.VUS || 20),
      duration: __ENV.DURATION || '60s',
    },
  },
  thresholds: {
    unexpected_errors: ['rate<0.01'],
    'http_req_duration{endpoint:guest-read}': ['p(95)<500'],
    'http_req_duration{endpoint:guest-write}': ['p(95)<1000'],
  },
};

export function setup() {
  const response = http.get(`${baseUrl}/api/v1/products`);
  const body = response.json();
  const product = body && body.data && body.data.products && body.data.products[0];
  if (!product || !product._id) throw new Error('Benchmark product is missing');
  return { productId: product._id };
}

export default function (data) {
  if (!joined) {
    const tableToken = freshTableToken(baseUrl);
    const joinResponse = http.post(
      `${baseUrl}/api/v1/table-sessions/join`,
      JSON.stringify({ tableToken }),
      {
        headers: { 'Content-Type': 'application/json' },
        tags: { endpoint: 'guest-join' },
      },
    );
    const joinedOk = check(joinResponse, { 'guest joined': (value) => value.status === 200 });
    unexpectedErrors.add(!joinedOk);
    if (!joinedOk) return;
    const cookie =
      joinResponse.cookies.mc_guest &&
      joinResponse.cookies.mc_guest[0] &&
      joinResponse.cookies.mc_guest[0].value;
    if (!cookie) {
      unexpectedErrors.add(true);
      return;
    }
    guestCookie = `mc_guest=${cookie}`;
    joined = true;
  }

  if (Math.random() < 0.8) {
    const response = http.get(`${baseUrl}/api/v1/orders/mine`, {
      headers: { Cookie: guestCookie },
      tags: { endpoint: 'guest-read' },
    });
    const ok = check(response, { 'guest orders HTTP 200': (value) => value.status === 200 });
    unexpectedErrors.add(!ok);
    sleep(Number(__ENV.THINK_TIME_SECONDS || 1));
    return;
  }

  const response = http.post(
    `${baseUrl}/api/v1/orders`,
    JSON.stringify({
      items: [
        {
          productId: data.productId,
          variantId: null,
          sugarLevel: '50%',
          iceLevel: 'normal-ice',
          toppingIds: [],
          quantity: 1,
        },
      ],
      note: 'synthetic benchmark',
    }),
    {
      headers: {
        'Content-Type': 'application/json',
        Cookie: guestCookie,
        'Idempotency-Key': `k6-${__VU}-${__ITER}-${Date.now()}`,
      },
      tags: { endpoint: 'guest-write' },
    },
  );
  const ok = check(response, { 'guest order HTTP 201': (value) => value.status === 201 });
  unexpectedErrors.add(!ok);
  // Keep this workload below the per-device pending-payment cap without
  // fabricating a staff receipt or sending unpaid orders into the KDS.
  if (ok) {
    const orderId = response.json().data.order._id;
    const cancelled = http.post(`${baseUrl}/api/v1/orders/${orderId}/cancel`, null, {
      headers: { Cookie: guestCookie },
      tags: { endpoint: 'guest-cancel' },
    });
    unexpectedErrors.add(cancelled.status !== 200);
  }
  sleep(Number(__ENV.THINK_TIME_SECONDS || 1));
}
