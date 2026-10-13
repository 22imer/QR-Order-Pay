import http from 'k6/http';

export function freshTableToken(baseUrl) {
  const displayToken = __ENV.TABLE_DISPLAY_TOKEN;
  if (!displayToken) throw new Error('Set TABLE_DISPLAY_TOKEN from the isolated benchmark display');
  const response = http.get(`${baseUrl}/api/v1/table-displays/qr`, {
    headers: { 'X-Table-Display-Token': displayToken },
    tags: { endpoint: 'table-qr' },
  });
  if (response.status !== 200) throw new Error(`Cannot obtain QR: HTTP ${response.status}`);
  return response.json().data.url.split('/t/')[1];
}
