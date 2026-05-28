# Double Financing Next Frontend

Simple Next.js frontend for the NestJS `DoubleFinancingPreventer` backend.

## Run

```bash
npm install
npm run dev
```

The UI proxies requests to the backend through `/api/backend/*`.

Environment:

```bash
BACKEND_URL=http://127.0.0.1:8080
BACKEND_API_KEY=replace-if-backend-api-key-is-enabled
```

Start the backend first on port `8080`.
