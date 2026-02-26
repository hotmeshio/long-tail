# Contributing

## Running the Demo

The repository includes a working server with two example workflows (`reviewContent` and `verifyDocument`), Postgres, and NATS.

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/)

### Run

```bash
git clone https://github.com/hotmeshio/long-tail.git
cd long-tail
docker compose up
```

Postgres, NATS, and the API server start together. Migrations run automatically.

Default ports are `3000` (API), `5432` (Postgres), `4222`/`8222` (NATS). Override any of them:

```bash
LT_PORT=3001 LT_PG_PORT=5433 LT_NATS_PORT=4223 docker compose up
```

## Testing

```bash
# Start Postgres and NATS
docker compose up -d postgres nats

# Run all tests
npm test

# Run workflow tests
npm run test:workflows
```

## Development Setup

1. Fork the repository and clone your fork
2. Install dependencies: `npm install`
3. Start infrastructure: `docker compose up -d postgres nats`
4. Run tests to verify your setup: `npm test`

## Pull Requests

- Create a feature branch from `main`
- Keep changes focused — one concern per PR
- Add or update tests for any new behavior
- Run `npm test` before submitting

## Issues

Report bugs and request features at [github.com/hotmeshio/long-tail/issues](https://github.com/hotmeshio/long-tail/issues).
