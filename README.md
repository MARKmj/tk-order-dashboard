# TK Order Dashboard

Vercel serverless dashboard for TK matrix order analysis.

## Environment Variables

Set these in Vercel Project Settings -> Environment Variables:

- `FEISHU_APP_ID`
- `FEISHU_APP_SECRET`
- `FEISHU_BASE_TOKEN`
- `FEISHU_TABLE_ID`
- `FEISHU_MAIN_VIEW_ID`
- `FEISHU_PROJECT_110_VIEW_ID`
- `FEISHU_GUANGXI_VIEW_ID`
- `DASHBOARD_ACCESS_CODE_MAIN`
- `DASHBOARD_ACCESS_CODE_PROJECT_110`
- `DASHBOARD_ACCESS_CODE_GUANGXI`
- `CRON_SECRET`
- `BLOB_READ_WRITE_TOKEN`
- `DASHBOARD_CACHE_PREFIX`

Do not commit real secrets to GitHub.

## Cached Loading

The dashboard is optimized for fast loading through server-side snapshots:

- `/api/cron-sync` syncs all projects from Feishu into Vercel Blob. Vercel Cron calls it with `Authorization: Bearer $CRON_SECRET`.
- `/api/refresh?project=main` validates the project card code, then reads the latest server snapshot. It does not call Feishu during normal dashboard refreshes.
- `/api/sync?project=main` validates the project card code and manually syncs that project from Feishu into the cache.
- Local development stores snapshots under `.cache/` when `BLOB_READ_WRITE_TOKEN` is not configured.

The cron schedule is set to every 2 hours in `vercel.json`. Vercel Hobby plans may only allow daily cron frequency; use Pro or an external scheduler if the two-hour cadence does not run.

## Local Check

```bash
npm run check
npm run smoke
```

## Routes

- `/` renders the project portal and dashboard shell.
- `/api/auth` validates the selected project's access code.
- `/api/refresh?project=main` reads the selected project's cached snapshot after validating that project's access code.
- `/api/sync?project=main` manually refreshes the selected project's cached snapshot from Feishu.
- `/api/cron-sync` refreshes all project snapshots for scheduled background sync.
