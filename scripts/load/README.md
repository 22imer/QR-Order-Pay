# Load-test scripts

These scripts target the isolated `maycafe-benchmark` Compose project by default (`http://web:8080` from the k6 container).

- `menu.js`: fixed arrival-rate steps 25 → 50 → 100 → 200 → 400 → 600 → 700 RPS.
- `menu-constant.js`: one fixed RPS level, used to locate the highest level that passes every threshold.
- `guest-flow.js`: valid per-VU guest cookies, 80% order reads and 20% idempotent order writes; new unpaid orders are cancelled to free the pending-payment cap.
- `realtime.js`: authenticated Socket.IO-over-WebSocket connections held for a configured duration.

Production limits remain the default. The benchmark project sets only `RATE_LIMIT_GUEST_MUTATION_MAX` high enough for many synthetic clients sharing the load-generator IP. This difference must be disclosed with results.

After a run, verify database invariants with `npm -w @may-cafe/server run check:benchmark` in an environment whose `MONGODB_URI` points to a database containing `benchmark` in its name. The benchmark seed rebuilds indexes after `dropDatabase()`; do not bypass this step before concurrent guest tests.

The dated environment, exact results, limitations and artifact locations are recorded in `docs/performance-report.md`.

## Reproduce with Docker Desktop

Create a Git-ignored `.env.benchmark` with `WEB_PORT=8081`, `MONGO_DATABASE=maycafe_benchmark`, `PUBLIC_APP_URL=http://localhost:8081`, `RATE_LIMIT_GUEST_MUTATION_MAX=100000` and two different random JWT secrets. Then run from the repository root:

```powershell
docker compose -p maycafe-benchmark -f compose.production.yaml --env-file .env.benchmark up -d --build
$env:BENCHMARK_DISPLAY_TOKEN = node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64url'))"
docker compose -p maycafe-benchmark -f compose.production.yaml --env-file .env.benchmark exec -e BENCHMARK_DISPLAY_TOKEN server-guest-a node server/dist/src/seeds/benchmark.js

docker run --rm --network maycafe-benchmark_default `
  -v "${PWD}/scripts/load:/scripts:ro" -v "${PWD}/.cache/load:/results" `
  -e BASE_URL=http://web:8080 -e TARGET_RPS=90 `
  grafana/k6:latest run --summary-export=/results/menu-two-backends-90.json /scripts/menu-constant.js

docker run --rm --network maycafe-benchmark_default `
  -v "${PWD}/scripts/load:/scripts:ro" -v "${PWD}/.cache/load:/results" `
  -e BASE_URL=http://web:8080 -e TABLE_DISPLAY_TOKEN=$env:BENCHMARK_DISPLAY_TOKEN `
  -e VUS=20 -e DURATION=60s -e THINK_TIME_SECONDS=1 `
  grafana/k6:latest run --summary-export=/results/guest-flow-20-users.json /scripts/guest-flow.js

docker compose -p maycafe-benchmark -f compose.production.yaml --env-file .env.benchmark exec server-guest-a node server/dist/scripts/benchmark-invariants.js
```

Run each comparison after a fresh `seed:benchmark`, keep warm-up/duration identical, and sample `docker stats` during the measurement rather than only after it. The ramp command substitutes `/scripts/menu.js`; realtime substitutes `/scripts/realtime.js` with `CONNECTIONS` and `HOLD_MS`.

Guest and realtime workloads obtain fresh rotating QR tickets with the private display credential. Never use a production display credential. The additional QR requests and unpaid-order cancellations change the workload; old performance figures are historical and must not be presented as measurements of this implementation.
