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
- `DASHBOARD_CACHE_SECRET`
- `DASHBOARD_TIME_ZONE`
- `PRODUCT_TRANSLATION_ENABLED`
- `PRODUCT_TRANSLATION_API_KEY`
- `PRODUCT_TRANSLATION_BASE_URL`
- `PRODUCT_TRANSLATION_MODEL`
- `PRODUCT_TRANSLATION_BATCH_SIZE`
- `PRODUCT_TRANSLATION_SYNC_LIMIT`
- `PRODUCT_TRANSLATION_TIMEOUT_MS`

Do not commit real secrets to GitHub.

## Cached Loading

The dashboard is optimized for fast loading through server-side snapshots:

- `/api/cron-sync` syncs Feishu data into encrypted Vercel Blob snapshots. GitHub Actions calls it with `Authorization: Bearer $CRON_SECRET`.
- `/api/refresh?project=main` validates the project card code, then reads the latest server snapshot. It does not call Feishu during normal dashboard refreshes.
- `/api/sync?project=main` validates the project card code and manually syncs that project from Feishu into the cache.
- Local development stores snapshots under `.cache/` when `BLOB_READ_WRITE_TOKEN` is not configured.

The sync schedule is handled by `.github/workflows/sync-cache.yml` every 2 hours because Vercel Hobby plans do not allow two-hour Vercel Cron frequency. Snapshots are encrypted before writing to Blob; set `DASHBOARD_CACHE_SECRET` to use a dedicated cache key, otherwise the server falls back to existing server secrets.

Order dates and fallback hours are grouped with `DASHBOARD_TIME_ZONE`, defaulting to `Asia/Shanghai`, so Vercel's UTC runtime does not shift Feishu order timestamps into the wrong day.

## Product Translation Cache

During `/api/cron-sync` and `/api/sync`, the server builds a shared product translation cache. If `PRODUCT_TRANSLATION_API_KEY` is configured, new or Feishu-seeded products are translated into short Chinese ecommerce titles and saved for reuse. If the key is not configured, the dashboard keeps working by falling back to `商品名称-中文`, then the original product name or ID.

`PRODUCT_TRANSLATION_BASE_URL` uses the OpenAI-compatible chat completions API format. Keep `PRODUCT_TRANSLATION_SYNC_LIMIT` modest so scheduled syncs translate new products gradually instead of slowing the whole dashboard.

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