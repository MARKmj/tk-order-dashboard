# TK Order Dashboard

Vercel serverless dashboard for TK matrix order analysis.

## Environment Variables

Set these in Vercel Project Settings -> Environment Variables:

- `FEISHU_APP_ID`
- `FEISHU_APP_SECRET`
- `FEISHU_BASE_TOKEN`
- `FEISHU_TABLE_ID`
- `FEISHU_MAIN_VIEW_ID`
- `FEISHU_GUANGXI_VIEW_ID`
- `DASHBOARD_ACCESS_CODE_MAIN`
- `DASHBOARD_ACCESS_CODE_GUANGXI`

Do not commit real secrets to GitHub.

## Local Check

```bash
npm run check
npm run smoke
```

## Routes

- `/` renders the project portal and dashboard shell.
- `/api/auth` validates the selected project's access code.
- `/api/refresh?project=main` reloads the selected Feishu Base view after validating that project's access code.
