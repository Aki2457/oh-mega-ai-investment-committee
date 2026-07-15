# Virtual Fund

A virtual, paper-only fund with three operating modes and a four-role investment committee.

## Modes

- Balanced: 50% stocks and 50% cash.
- Attach: up to 75% stocks and at least 25% cash. This mode attaches capital to the strongest verified signals.
- Lockdown: 100% cash.

The allocation engine also enforces long-only positions, a 10% single-stock cap, an approved-security universe, stale-data freezes, and Human approval before a paper rebalance.

## Committee

1. Decision Agent combines quantitative features with current web research.
2. Risk Agent challenges the evidence and the proposed risk.
3. CEO Agent makes the main recommendation.
4. Human approves or rejects the recommendation.

## Website

The Sites application has three pages: Command, Research, and Ledger. It includes the mode selector, committee status, Human checkpoint, web-enabled AI research, stock probabilities, paper holdings, and the decision journal.

## Docker backend

Copy `.env.docker.example` to `.env`, add the required provider keys, then run:

```powershell
docker compose up -d --build
```

The backend and its API will be available at `http://localhost:8890`. Persistent paper-fund data is stored in the `virtual-fund-data` volume.

The image name is `virtual-fund-backend:latest`.

Useful API routes:

- `GET /api/status`
- `GET /api/weather`
- `GET /api/portfolio`
- `GET /api/universe`
- `POST /api/committee/run`
- `GET|POST /api/committee/approval`
- `POST /api/chat`

This system has no broker connection and cannot place real-money trades.
