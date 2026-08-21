# TK Order Dashboard

Vercel serverless dashboard for TK matrix order analysis.

## Environment Variables

Set these in Vercel Project Settings -> Environment Variables:

- `FEISHU_APP_ID`
- `FEISHU_APP_SECRET`
- `FEISHU_BASE_TOKEN`
- `FEISHU_TABLE_ID`
- `FEISHU_VIEW_ID`
- `DASHBOARD_ACCESS_CODE`

Do not commit real secrets to GitHub.

## Local Check

```bash
npm run check
npm run smoke
```

## Routes

- `/` renders the dashboard by reading Feishu Base from the server.
- `/api/refresh` reloads the latest Feishu Base data.
- `/api/auth` validates the dashboard access code.
