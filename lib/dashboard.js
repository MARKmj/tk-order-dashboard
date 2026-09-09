#!/usr/bin/env node

const crypto = require("crypto");

const DEFAULT_BASE_TOKEN = "YzN8bg9MiauKPFsvAAGckfD1ndh";
const DEFAULT_TABLE_ID = "tblng99luev6ElZ4";
const DEFAULT_MAIN_VIEW_ID = "vew5FUCk22";
const DEFAULT_GUANGXI_VIEW_ID = "vewkUVhrcn";
const DEFAULT_PROJECT_110_VIEW_ID = "vewNt9gdfG";
const PAGE_SIZE = 500;

const PROJECTS = [
  {
    id: "main",
    name: "TK矩阵总览",
    shortName: "总览",
    subtitle: "贯一恒新科技 TK 矩阵项目整体经营数据",
    description: "汇总矩阵账号、达人带货、商品订单与佣金表现，用于观察整体增长、市场结构和投入方向。",
    baseToken: process.env.FEISHU_MAIN_BASE_TOKEN || process.env.FEISHU_BASE_TOKEN || DEFAULT_BASE_TOKEN,
    tableId: process.env.FEISHU_MAIN_TABLE_ID || process.env.FEISHU_TABLE_ID || DEFAULT_TABLE_ID,
    viewId: process.env.FEISHU_MAIN_VIEW_ID || process.env.FEISHU_VIEW_ID || DEFAULT_MAIN_VIEW_ID,
    accessEnv: "DASHBOARD_ACCESS_CODE_MAIN",
    fallbackAccessEnv: "DASHBOARD_ACCESS_CODE",
    allowTableFallback: true,
  },
  {
    id: "project110",
    name: "110项目",
    shortName: "110",
    subtitle: "110项目 TK 矩阵项目独立经营数据",
    description: "按 110 项目视图拉取订单数据，独立观察达人效率、商品趋势、订单增长和佣金贡献。",
    baseToken: process.env.FEISHU_PROJECT_110_BASE_TOKEN || process.env.FEISHU_BASE_TOKEN || DEFAULT_BASE_TOKEN,
    tableId: process.env.FEISHU_PROJECT_110_TABLE_ID || process.env.FEISHU_TABLE_ID || DEFAULT_TABLE_ID,
    viewId: process.env.FEISHU_PROJECT_110_VIEW_ID || DEFAULT_PROJECT_110_VIEW_ID,
    accessEnv: "DASHBOARD_ACCESS_CODE_PROJECT_110",
  },
  {
    id: "guangxi",
    name: "广西团队",
    shortName: "广西",
    subtitle: "广西团队 TK 矩阵项目独立经营数据",
    description: "按广西团队视图拉取订单数据，独立查看达人、商品、趋势和收入贡献。",
    baseToken: process.env.FEISHU_GUANGXI_BASE_TOKEN || process.env.FEISHU_BASE_TOKEN || DEFAULT_BASE_TOKEN,
    tableId: process.env.FEISHU_GUANGXI_TABLE_ID || process.env.FEISHU_TABLE_ID || DEFAULT_TABLE_ID,
    viewId: process.env.FEISHU_GUANGXI_VIEW_ID || DEFAULT_GUANGXI_VIEW_ID,
    accessEnv: "DASHBOARD_ACCESS_CODE_GUANGXI",
  },
];

function publicProjects() {
  return PROJECTS.map(({ id, name, shortName, subtitle, description }) => ({ id, name, shortName, subtitle, description }));
}

function getProject(projectId = "main") {
  const project = PROJECTS.find((item) => item.id === projectId);
  if (!project) throw new Error("项目不存在");
  return project;
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function getProjectAccessCode(project) {
  return process.env[project.accessEnv] || (project.fallbackAccessEnv ? process.env[project.fallbackAccessEnv] : "");
}

function verifyProjectCode(projectId, code) {
  const project = getProject(projectId);
  const expected = getProjectAccessCode(project);
  if (!expected) return { ok: false, status: 500, error: "服务端未配置该项目卡密" };
  if (!safeEqual(code, expected)) return { ok: false, status: 401, error: "卡密错误" };
  return { ok: true, project };
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableFeishuError(response, data) {
  const message = data.msg || data.message || "";
  return response.status >= 500 || /Data not ready|try again later|too many|rate limit|timeout/i.test(message);
}

async function feishuJson(url, options = {}) {
  const maxAttempts = options.maxAttempts || 5;
  const requestOptions = { ...options };
  delete requestOptions.maxAttempts;
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let response;
    let data = {};
    try {
      response = await fetch(url, requestOptions);
      data = await response.json().catch(() => ({}));
      if (response.ok && data.code === 0) return data;
      const message = data.msg || data.message || `Feishu request failed: ${response.status}`;
      lastError = new Error(message);
      if (!isRetryableFeishuError(response, data) || attempt === maxAttempts) break;
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts) break;
    }
    await sleep(Math.min(1200 * attempt, 5000));
  }
  throw lastError || new Error("Feishu request failed");
}

async function feishuJsonOnce(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.code !== 0) {
    throw new Error(data.msg || data.message || `Feishu request failed: ${response.status}`);
  }
  return data;
}

async function getTenantAccessToken() {
  const data = await feishuJsonOnce("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      app_id: requiredEnv("FEISHU_APP_ID"),
      app_secret: requiredEnv("FEISHU_APP_SECRET"),
    }),
  });
  return data.tenant_access_token;
}

function isDataNotReady(error) {
  return /Data not ready|try again later/i.test(error?.message || "");
}

async function listRecordsPage(project, token, pageToken, useView) {
  const url = new URL(`https://open.feishu.cn/open-apis/bitable/v1/apps/${project.baseToken}/tables/${project.tableId}/records`);
  url.searchParams.set("page_size", String(PAGE_SIZE));
  if (useView && project.viewId) url.searchParams.set("view_id", project.viewId);
  if (pageToken) url.searchParams.set("page_token", pageToken);
  return feishuJson(url, {
    headers: { authorization: `Bearer ${token}` },
    maxAttempts: 3,
  });
}

async function listRecordsWithMode(project, token, useView) {
  const rows = [];
  let pageToken = "";
  do {
    const data = await listRecordsPage(project, token, pageToken, useView);
    for (const item of data.data?.items || []) rows.push(item.fields || {});
    pageToken = data.data?.page_token || "";
    if (!data.data?.has_more) break;
  } while (pageToken);
  return rows;
}

async function listRecords(project) {
  const token = await getTenantAccessToken();
  if (project.preferTableRead) {
    const rows = await listRecordsWithMode(project, token, false);
    return { rows, usedView: false };
  }
  try {
    const rows = await listRecordsWithMode(project, token, true);
    return { rows, usedView: true };
  } catch (error) {
    if (!project.allowTableFallback || !isDataNotReady(error)) throw error;
    const rows = await listRecordsWithMode(project, token, false);
    return { rows, usedView: false };
  }
}

function normalize(value) {
  if (Array.isArray(value)) {
    return value.map((item) => {
      if (item && typeof item === "object") return item.text || item.name || item.en_name || item.email || JSON.stringify(item);
      return item;
    }).join(", ");
  }
  if (value && typeof value === "object") return value.text || value.name || value.en_name || JSON.stringify(value);
  return value ?? "";
}

function parseMoney(value) {
  if (typeof value === "number") return value;
  const match = String(value || "").replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function parseDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function localDayKey(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function dayKey(value) {
  const date = parseDate(value);
  return date ? localDayKey(date) : "";
}

function parseHour(value, fallbackTime) {
  const direct = Number(String(value ?? "").match(/\d{1,2}/)?.[0]);
  if (Number.isFinite(direct) && direct >= 0 && direct <= 23) return direct;
  const date = parseDate(fallbackTime);
  return date ? date.getHours() : null;
}

function summarize(rows) {
  const accounts = new Set(rows.map((row) => row.account).filter(Boolean));
  const products = new Set(rows.map((row) => row.productId).filter(Boolean));
  const teams = new Set(rows.map((row) => row.team).filter(Boolean));
  const orders = rows.length;
  const commissionCny = rows.reduce((sum, row) => sum + row.actualCommissionCny, 0);
  const estimated = rows.reduce((sum, row) => sum + row.estimatedCommission, 0);
  const orderAmount = rows.reduce((sum, row) => sum + row.orderAmount, 0);
  const prices = rows.map((row) => row.price).filter((n) => n > 0);
  return {
    records: rows.length,
    orders,
    accounts: accounts.size,
    products: products.size,
    teams: teams.size,
    commissionCny,
    estimated,
    orderAmount,
    avgPrice: prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : 0,
    avgCommissionPerOrder: orders ? commissionCny / orders : 0,
    avgOrderAmountPerOrder: orders ? orderAmount / orders : 0,
    commissionRate: orderAmount ? commissionCny / orderAmount : 0,
    avgCommissionPerRecord: rows.length ? commissionCny / rows.length : 0,
  };
}

function groupBy(rows, keyFn) {
  const map = new Map();
  for (const row of rows) {
    const key = keyFn(row) || "未填写";
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return [...map.entries()].map(([key, items]) => ({ key, ...summarize(items), items }));
}

function daily(rows) {
  return groupBy(rows, (row) => row.orderDate)
    .filter((item) => item.key !== "未填写")
    .map((item) => ({ ...item, date: item.key }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function movingAverage(items, field, window = 7) {
  return items.map((item, idx) => {
    const slice = items.slice(Math.max(0, idx - window + 1), idx + 1);
    return slice.reduce((sum, d) => sum + d[field], 0) / slice.length;
  });
}

function normalizeRows(rows) {
  const field = (row, name) => normalize(row[name]);
  return rows.map((row) => ({
    team: field(row, "所属机构【团队】"),
    site: field(row, "站点"),
    account: field(row, "达人账号"),
    orderId: field(row, "订单号"),
    productId: field(row, "商品ID"),
    productName: field(row, "商品名称"),
    sku: field(row, "SKU"),
    price: parseMoney(field(row, "价格")),
    orderAmount: parseMoney(field(row, "订单金额")),
    estimatedCommission: parseMoney(field(row, "预估佣金")),
    actualCommissionCny: parseMoney(field(row, "实际佣金（人民币）")),
    orderTime: field(row, "订单创建时间"),
    orderDate: dayKey(field(row, "订单创建时间")),
    orderHour: parseHour(field(row, "订单时间"), field(row, "订单创建时间")),
  }));
}

function buildPayload(sourceRows, project, meta = {}) {
  const rows = normalizeRows(sourceRows);
  const dates = rows.map((row) => parseDate(row.orderTime)).filter(Boolean).sort((a, b) => a - b);
  const days = daily(rows);
  const ma7Orders = movingAverage(days, "orders");
  const ma7Commission = movingAverage(days, "commissionCny");
  return {
    generatedAt: new Date().toISOString(),
    source: {
      projectId: project.id,
      projectName: project.name,
      tableName: `${project.name}带货出单数据`,
      baseToken: project.baseToken,
      tableId: project.tableId,
      viewId: project.viewId,
      usedView: meta.usedView !== false,
      fallbackMode: meta.usedView === false ? "table" : "view",
      records: rows.length,
    },
    dateRange: {
      startLocal: dates[0] ? localDayKey(dates[0]) : "",
      endLocal: dates[dates.length - 1] ? localDayKey(dates[dates.length - 1]) : "",
    },
    summary: summarize(rows),
    daily: days.map((d, i) => ({ ...d, ma7Orders: ma7Orders[i], ma7Commission: ma7Commission[i] })),
    rawRows: rows,
  };
}

function emptyPayload(project = getProject()) {
  return {
    generatedAt: new Date().toISOString(),
    source: {
      projectId: project.id,
      projectName: project.name,
      tableName: `${project.name}带货出单数据`,
      baseToken: project.baseToken,
      tableId: project.tableId,
      viewId: project.viewId,
      usedView: true,
      fallbackMode: "view",
      records: 0,
    },
    dateRange: { startLocal: "", endLocal: "" },
    summary: summarize([]),
    daily: [],
    rawRows: [],
  };
}

function htmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderHtml(payload) {
  const json = JSON.stringify(payload).replaceAll("</script", "<\\/script");
  const projectsJson = JSON.stringify(publicProjects()).replaceAll("</script", "<\\/script");
  const generated = new Date(payload.generatedAt).toLocaleString("zh-CN", { hour12: false });
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>TK 矩阵带货订单看板</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f5f7fb;
      --panel: #fff;
      --ink: #172033;
      --muted: #657083;
      --line: #d9e0ea;
      --blue: #2563eb;
      --green: #14825d;
      --red: #c24135;
      --amber: #b46b08;
      --cyan: #0784a8;
      --violet: #7452c7;
      --soft: #eef3fb;
      --shadow: 0 10px 30px rgba(32, 42, 63, .08);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
      background: var(--bg);
      color: var(--ink);
      letter-spacing: 0;
      overflow-x: hidden;
    }
    .shell { max-width: 1500px; margin: 0 auto; padding: 24px; }
    header { display: grid; grid-template-columns: 1fr auto; gap: 18px; align-items: end; margin-bottom: 14px; }
    h1 { margin: 0 0 8px; font-size: 28px; line-height: 1.2; }
    h2 { margin: 0; font-size: 16px; }
    .sub, .caption, .muted { color: var(--muted); font-size: 12px; line-height: 1.5; }
    .toolbar, .filters, .control-row { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
    .toolbar { justify-content: flex-end; }
    select, input, button {
      height: 38px;
      border: 1px solid var(--line);
      background: white;
      border-radius: 6px;
      padding: 0 10px;
      color: var(--ink);
      font-size: 13px;
      min-width: 0;
      max-width: 100%;
    }
    select { text-overflow: ellipsis; white-space: nowrap; }
    button { cursor: pointer; font-weight: 650; }
    button.primary { background: var(--blue); color: #fff; border-color: var(--blue); }
    button:disabled { opacity: .55; cursor: wait; }
    .panel { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; box-shadow: var(--shadow); min-width: 0; overflow: hidden; }
    .filter-panel { padding: 12px; margin-bottom: 14px; }
    .grid { display: grid; gap: 14px; }
    .kpis { grid-template-columns: repeat(8, minmax(0, 1fr)); }
    .metric { padding: 15px; min-height: 112px; }
    .metric .label { color: var(--muted); font-size: 12px; margin-bottom: 8px; }
    .metric .value { font-size: 24px; line-height: 1.1; font-weight: 780; }
    .metric .hint { color: var(--muted); font-size: 12px; margin-top: 9px; line-height: 1.45; }
    .layout { grid-template-columns: minmax(0, 1.45fr) minmax(380px, .95fr); margin-top: 14px; }
    .trend-layout { grid-template-columns: repeat(2, minmax(0, 1fr)); margin-top: 14px; }
    .time-layout { grid-template-columns: minmax(420px, .85fr) minmax(0, 1.15fr); margin-top: 14px; }
    .panel-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; padding: 14px 16px 0; min-width: 0; flex-wrap: wrap; }
    .panel-head > div:first-child { min-width: 0; }
    .panel-head select { max-width: min(360px, 48vw); }
    .trend-card .panel-head { display: block; }
    .trend-card .trend-control { width: 100%; margin-top: 10px; }
    .trend-card .trend-control select { width: 100%; max-width: 100%; min-width: 0; display: block; }
    .trend-search { display: grid; grid-template-columns: 180px minmax(0, 1fr); gap: 8px; width: 100%; }
    .trend-search input { width: 100%; }
    .chart { height: 340px; padding: 8px 14px 14px; }
    .chart.short { height: 300px; }
    .heatmap-wrap { max-height: 340px; overflow: auto; padding: 8px 14px 14px; }
    .heatmap-grid { display: grid; grid-template-columns: 72px repeat(24, minmax(28px, 1fr)); min-width: 820px; gap: 3px; align-items: stretch; }
    .heat-corner, .heat-hour, .heat-row-label { color: var(--muted); font-size: 11px; line-height: 24px; height: 24px; white-space: nowrap; }
    .heat-hour { text-align: center; position: sticky; top: 0; z-index: 2; background: var(--panel); }
    .heat-row-label { position: sticky; left: 0; z-index: 1; background: var(--panel); overflow: hidden; text-overflow: ellipsis; }
    .heat-corner { position: sticky; left: 0; top: 0; z-index: 3; background: var(--panel); }
    .heat-cell { height: 24px; border-radius: 4px; background: #edf2f7; cursor: default; }
    svg { width: 100%; height: 100%; display: block; overflow: hidden; }
    .line-orders { fill: none; stroke: var(--blue); stroke-width: 2.4; }
    .line-commission { fill: none; stroke: var(--green); stroke-width: 2.4; }
    .line-focus { fill: none; stroke: var(--violet); stroke-width: 2.4; }
    .bar { fill: var(--blue); opacity: .84; }
    .bar.alt { fill: var(--green); }
    .legend { display: flex; gap: 12px; color: var(--muted); font-size: 12px; flex-wrap: wrap; }
    .dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; margin-right: 5px; }
    .dot.blue { background: var(--blue); } .dot.green { background: var(--green); } .dot.violet { background: var(--violet); }
    .tables { grid-template-columns: repeat(2, minmax(0, 1fr)); margin-top: 14px; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    th, td { padding: 10px 12px; border-bottom: 1px solid var(--line); font-size: 12px; text-align: left; vertical-align: top; }
    th { color: var(--muted); font-weight: 700; background: #fbfcfe; }
    .rank-scroll { height: 430px; overflow: auto; margin-top: 10px; border-top: 1px solid var(--line); }
    .rank-scroll thead th { position: sticky; top: 0; z-index: 1; }
    td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
    .rank { width: 42px; color: var(--muted); }
    .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
    .progress { height: 6px; background: #edf1f6; border-radius: 999px; overflow: hidden; margin-top: 6px; }
    .progress span { display: block; height: 100%; background: var(--blue); }
    .insights { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; margin-top: 14px; }
    .insight { padding: 15px; }
    .insight strong { display: block; font-size: 14px; margin-bottom: 8px; }
    .insight p { margin: 0; color: var(--muted); line-height: 1.55; font-size: 13px; }
    .search-row { padding: 12px 16px; border-bottom: 1px solid var(--line); display: flex; gap: 10px; align-items: center; }
    .search-row input { flex: 1; min-width: 180px; }
    .scroll { max-height: 430px; overflow: auto; }
    .pill { display: inline-flex; align-items: center; height: 24px; padding: 0 8px; border-radius: 999px; background: var(--soft); color: var(--blue); font-size: 12px; }
    .status { min-width: 160px; color: var(--muted); font-size: 12px; }
    .export-btn { color: #fff; background: var(--green); border-color: var(--green); min-width: 156px; }
    .control-row select { width: 112px; }
    .tooltip {
      position: fixed;
      z-index: 20;
      display: none;
      max-width: 260px;
      padding: 10px 12px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: rgba(255, 255, 255, .96);
      box-shadow: 0 12px 32px rgba(23, 32, 51, .16);
      color: var(--ink);
      font-size: 12px;
      line-height: 1.55;
      pointer-events: none;
    }
    .tooltip strong { display: block; margin-bottom: 4px; font-size: 13px; }
    .auth-overlay {
      position: fixed;
      inset: 0;
      z-index: 50;
      display: block;
      padding: 28px;
      overflow: auto;
      background: #07111d;
      color: #f8fbff;
    }
    .auth-card {
      width: min(1160px, 100%);
      min-height: calc(100vh - 56px);
      margin: 0 auto;
      display: grid;
      grid-template-columns: minmax(0, 1.15fr) minmax(360px, .85fr);
      gap: 28px;
      align-items: center;
    }
    .landing-copy { min-width: 0; }
    .auth-brand { color: #80f0d6; font-size: 13px; font-weight: 760; margin-bottom: 12px; letter-spacing: .08em; }
    .auth-card h2 { font-size: clamp(34px, 5vw, 58px); line-height: 1.05; margin: 0 0 16px; max-width: 720px; }
    .auth-card p { margin: 0; color: rgba(232, 240, 250, .78); font-size: 14px; line-height: 1.75; max-width: 700px; }
    .landing-stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin-top: 26px; max-width: 680px; }
    .landing-stat { border: 1px solid rgba(129, 222, 240, .24); background: rgba(255, 255, 255, .07); border-radius: 8px; padding: 13px; }
    .landing-stat strong { display: block; font-size: 22px; line-height: 1.1; margin-bottom: 7px; }
    .landing-stat span { color: rgba(232, 240, 250, .68); font-size: 12px; line-height: 1.45; }
    .capability-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-top: 16px; max-width: 680px; }
    .capability { border: 1px solid rgba(129, 222, 240, .18); background: rgba(1, 7, 15, .34); border-radius: 8px; padding: 12px; }
    .capability strong { display: block; font-size: 13px; margin-bottom: 6px; }
    .capability span { display: block; color: rgba(232, 240, 250, .64); font-size: 12px; line-height: 1.55; }
    .login-panel { background: rgba(248, 251, 255, .96); color: var(--ink); border: 1px solid rgba(255, 255, 255, .34); border-radius: 8px; box-shadow: 0 22px 70px rgba(0, 0, 0, .36); padding: 20px; }
    .login-panel h3 { margin: 0 0 8px; font-size: 19px; }
    .login-panel p { color: var(--muted); font-size: 13px; line-height: 1.6; }
    .project-grid { display: grid; grid-template-columns: 1fr; gap: 10px; margin: 16px 0; }
    .project-card {
      display: block;
      width: 100%;
      min-height: 96px;
      height: auto;
      padding: 14px;
      text-align: left;
      border-color: var(--line);
      background: #fbfcfe;
    }
    .project-card strong { display: block; font-size: 16px; margin-bottom: 7px; }
    .project-card span { display: block; color: var(--muted); font-size: 12px; line-height: 1.55; font-weight: 500; }
    .project-card.active { border-color: var(--blue); background: #eff5ff; box-shadow: inset 0 0 0 1px var(--blue); }
    .auth-form { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; margin-top: 12px; }
    .auth-form input { width: 100%; }
    .auth-error { min-height: 20px; margin-top: 10px; color: var(--red); font-size: 12px; }
    .project-chip { height: 38px; display: inline-flex; align-items: center; padding: 0 11px; border: 1px solid var(--line); border-radius: 6px; background: white; color: var(--muted); font-size: 13px; }
    body.locked .shell { filter: blur(8px); pointer-events: none; user-select: none; }
    @media (max-width: 1220px) {
      .kpis { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .layout, .trend-layout, .time-layout, .tables, .insights { grid-template-columns: 1fr; }
      header { grid-template-columns: 1fr; }
      .toolbar { justify-content: flex-start; }
    }
    @media (max-width: 720px) {
      .shell { padding: 14px; }
      .kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      h1 { font-size: 22px; }
      .metric .value { font-size: 21px; }
      .chart { height: 280px; }
      .trend-search { grid-template-columns: 1fr; }
      .auth-overlay { padding: 14px; }
      .auth-card { min-height: auto; grid-template-columns: 1fr; }
      .landing-stats { grid-template-columns: 1fr; }
      .capability-grid { grid-template-columns: 1fr; }
      .project-grid { grid-template-columns: 1fr; }
      .auth-form { grid-template-columns: 1fr; }
      th:nth-child(4), td:nth-child(4) { display: none; }
    }
  </style>
</head>
<body class="locked">
  <section class="auth-overlay" id="authOverlay" aria-modal="true" role="dialog">
    <div class="auth-card">
      <div class="landing-copy">
        <div class="auth-brand">GUANYI HENGXIN TECHNOLOGY</div>
        <h2>TikTok 矩阵带货项目数据中心</h2>
        <p>贯一恒新科技围绕 TikTok 矩阵账号运营、短视频商品内容分发与带货效果追踪，构建面向跨境商品的增长分析系统。看板用于沉淀订单、GMV、佣金、达人效率、商品趋势和市场结构，帮助团队判断下一阶段选品、投放和账号资源配置。</p>
        <div class="landing-stats">
          <div class="landing-stat"><strong>矩阵运营</strong><span>多账号、多达人、多项目统一归集，按项目独立授权查看。</span></div>
          <div class="landing-stat"><strong>GMV追踪</strong><span>从订单金额到实际佣金，观察商品真实成交与变现能力。</span></div>
          <div class="landing-stat"><strong>趋势决策</strong><span>按达人和商品识别延续、衰退、回升，服务下一轮带货选择。</span></div>
        </div>
        <div class="capability-grid">
          <div class="capability"><strong>项目隔离</strong><span>不同客户或团队可配置独立视图与卡密，便于后续扩展更多项目。</span></div>
          <div class="capability"><strong>经营复盘</strong><span>按日期、站点、团队、达人、商品多维筛选，沉淀可复用的经营判断。</span></div>
        </div>
      </div>
      <div class="login-panel">
        <h3>进入项目看板</h3>
        <p id="selectedProjectText">请选择项目，并输入对应卡密。</p>
        <div class="project-grid" id="projectGrid"></div>
        <form class="auth-form" id="authForm">
          <input id="accessCode" type="password" autocomplete="current-password" placeholder="请输入卡密" />
          <button class="primary" id="authBtn" type="submit">进入</button>
        </form>
        <div class="auth-error" id="authError"></div>
      </div>
    </div>
  </section>
  <main class="shell">
    <header>
      <div>
        <h1>TK 矩阵带货订单看板</h1>
        <div class="sub">数据源：${htmlEscape(payload.source.tableName)}｜${htmlEscape(payload.dateRange.startLocal)} 至 ${htmlEscape(payload.dateRange.endLocal)}｜生成时间：${htmlEscape(generated)}</div>
      </div>
      <div class="toolbar">
        <span class="project-chip" id="currentProjectName">${htmlEscape(payload.source.projectName || "TK矩阵总览")}</span>
        <button id="switchProjectBtn" type="button">切换项目</button>
        <button class="primary" id="refreshBtn" type="button">刷新数据</button>
        <span class="status" id="refreshStatus">线上服务可一键刷新</span>
      </div>
    </header>

    <section class="panel filter-panel">
      <div class="filters">
        <label class="muted">开始日期 <input id="startDate" type="date" /></label>
        <label class="muted">结束日期 <input id="endDate" type="date" /></label>
        <select id="siteFilter"><option value="">全部站点</option></select>
        <select id="teamFilter"><option value="">全部团队</option></select>
        <select id="accountFilter"><option value="">全部达人</option></select>
        <button id="resetFilters" type="button">重置筛选</button>
      </div>
    </section>

    <section class="grid kpis" id="kpis"></section>

    <section class="grid layout">
      <div class="panel">
        <div class="panel-head">
          <div><h2>每日订单与佣金趋势</h2><div class="caption">订单按明细行计算，悬浮可查看 GMV</div></div>
          <div class="legend"><span><i class="dot blue"></i>订单</span><span><i class="dot green"></i>佣金</span></div>
        </div>
        <div class="chart"><svg id="trendChart"></svg></div>
      </div>
      <div class="panel">
        <div class="panel-head">
          <div><h2>站点收入结构</h2><div class="caption">按实际佣金人民币排序</div></div>
        </div>
        <div class="chart"><svg id="siteChart"></svg></div>
      </div>
    </section>

    <section class="grid time-layout">
      <div class="panel">
        <div class="panel-head">
          <div><h2>小时出单趋势</h2><div class="caption">按「订单时间」公式字段聚合 0-23 点</div></div>
          <div class="legend"><span><i class="dot blue"></i>订单</span><span><i class="dot green"></i>佣金</span></div>
        </div>
        <div class="chart short"><svg id="hourTrendChart"></svg></div>
      </div>
      <div class="panel">
        <div class="panel-head">
          <div><h2>日期×小时出单热力图</h2><div class="caption">颜色越深代表该日期该小时出单越集中</div></div>
        </div>
        <div class="heatmap-wrap" id="hourHeatmap"></div>
      </div>
    </section>

    <section class="grid trend-layout">
      <div class="panel trend-card">
        <div class="panel-head">
          <div><h2>达人出单趋势</h2><div class="caption">选择达人看下一阶段是否继续投入</div></div>
          <div class="trend-control"><select id="accountTrendSelect"></select></div>
        </div>
        <div class="chart short"><svg id="accountTrendChart"></svg></div>
      </div>
      <div class="panel trend-card">
        <div class="panel-head">
          <div><h2>商品出单趋势</h2><div class="caption">识别爆品延续、衰退和回升</div></div>
          <div class="trend-control trend-search">
            <input id="productIdSearch" placeholder="搜索商品ID" />
            <select id="productTrendSelect"></select>
          </div>
        </div>
        <div class="chart short"><svg id="productTrendChart"></svg></div>
      </div>
    </section>

    <section class="insights" id="insights"></section>

    <section class="grid tables">
      <div class="panel">
        <div class="panel-head">
          <div><h2 id="accountTitle">达人收入</h2><div class="caption">可按佣金、GMV 或订单排序</div></div>
          <div class="control-row">
            <select id="accountSort"><option value="commission">佣金排序</option><option value="orderAmount">GMV排序</option><option value="orders">订单排序</option></select>
            <select id="accountLimit"></select>
            <button class="export-btn" id="exportAccount" type="button">导出当前榜单Excel</button>
          </div>
        </div>
        <div id="accountTable"></div>
      </div>
      <div class="panel">
        <div class="panel-head">
          <div><h2 id="productTitle">商品收入</h2><div class="caption">可按佣金、GMV 或订单排序</div></div>
          <div class="control-row">
            <select id="productSort"><option value="commission">佣金排序</option><option value="orderAmount">GMV排序</option><option value="orders">订单排序</option></select>
            <select id="productLimit"></select>
            <button class="export-btn" id="exportProduct" type="button">导出当前榜单Excel</button>
          </div>
        </div>
        <div id="productTable"></div>
      </div>
      <div class="panel">
        <div class="panel-head"><h2>团队对比</h2><div class="caption">团队订单、GMV 与佣金</div></div>
        <div id="teamTable"></div>
      </div>
      <div class="panel">
        <div class="panel-head"><h2>站点对比</h2><div class="caption">市场 GMV 分布与变现强度</div></div>
        <div id="siteTable"></div>
      </div>
    </section>

    <section class="panel" style="margin-top:14px; overflow:hidden;">
      <div class="search-row">
        <span class="pill">订单明细</span>
        <input id="searchInput" placeholder="搜索达人、商品、订单号、团队" />
      </div>
      <div class="scroll" id="detailTable"></div>
    </section>
  </main>
  <div class="tooltip" id="chartTooltip"></div>

  <script>
    let payload = ${json};
    const projects = ${projectsJson};
    const limits = [10, 20, 50, 100, 500, "all"];
    const initialProjectId = new URLSearchParams(location.search).get("project") || payload.source.projectId || projects[0]?.id || "main";
    const state = {
      projectId: initialProjectId,
      startDate: payload.dateRange.startLocal,
      endDate: payload.dateRange.endLocal,
      site: "",
      team: "",
      account: "",
      search: "",
      accountSort: "commission",
      productSort: "commission",
      accountLimit: 20,
      productLimit: 20,
      accountTrend: "",
      productTrend: "",
      productIdSearch: "",
    };

    const moneyFmt = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 });
    const decFmt = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 });
    function money(n) { return "¥" + moneyFmt.format(Number(n || 0)); }
    function fmt(n) { return decFmt.format(Number(n || 0)); }
    function pct(n) { return n == null ? "无基准" : ((n >= 0 ? "+" : "") + (n * 100).toFixed(1) + "%"); }
    function share(n) { return (Number(n || 0) * 100).toFixed(1) + "%"; }

    function filteredRows(includeEntityFilter = true) {
      const q = state.search.trim().toLowerCase();
      return payload.rawRows.filter(row => {
        if (state.startDate && row.orderDate < state.startDate) return false;
        if (state.endDate && row.orderDate > state.endDate) return false;
        if (state.site && row.site !== state.site) return false;
        if (state.team && row.team !== state.team) return false;
        if (includeEntityFilter && state.account && row.account !== state.account) return false;
        if (!q) return true;
        return [row.team, row.site, row.account, row.orderId, row.productId, row.productName].some(v => String(v || "").toLowerCase().includes(q));
      });
    }

    function summarize(rows) {
      const accounts = new Set(rows.map(r => r.account).filter(Boolean));
      const products = new Set(rows.map(r => r.productId).filter(Boolean));
      const orders = rows.length;
      const commission = rows.reduce((sum, r) => sum + Number(r.actualCommissionCny || 0), 0);
      const estimated = rows.reduce((sum, r) => sum + Number(r.estimatedCommission || 0), 0);
      const orderAmount = rows.reduce((sum, r) => sum + Number(r.orderAmount || 0), 0);
      const prices = rows.map(r => Number(r.price || 0)).filter(Boolean);
      return {
        records: rows.length,
        orders,
        accounts: accounts.size,
        products: products.size,
        commission,
        estimated,
        orderAmount,
        avgPrice: prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : 0,
        avgCommission: orders ? commission / orders : 0,
        avgOrderAmount: orders ? orderAmount / orders : 0,
        commissionRate: orderAmount ? commission / orderAmount : 0,
      };
    }

    function groupBy(rows, keyFn) {
      const map = new Map();
      rows.forEach(row => {
        const key = keyFn(row) || "未填写";
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(row);
      });
      return [...map.entries()].map(([key, items]) => ({ key, ...summarize(items), items }));
    }

    function daily(rows) {
      return groupBy(rows, r => r.orderDate).filter(d => d.key !== "未填写").map(d => ({ ...d, date: d.key })).sort((a, b) => a.date.localeCompare(b.date));
    }

    function hourLabel(hour) {
      return String(hour).padStart(2, "0") + ":00";
    }

    function hourly(rows) {
      return Array.from({ length: 24 }, (_, hour) => {
        const items = rows.filter(row => Number(row.orderHour) === hour);
        return { ...summarize(items), hour, date: hourLabel(hour) };
      });
    }

    function heatmapBuckets(rows) {
      const days = unique(rows.map(row => row.orderDate)).filter(Boolean);
      return days.map(date => ({
        date,
        hours: Array.from({ length: 24 }, (_, hour) => {
          const items = rows.filter(row => row.orderDate === date && Number(row.orderHour) === hour);
          return { ...summarize(items), date, hour, label: hourLabel(hour) };
        }),
      }));
    }

    function rankData(rows, keyFn, sortBy, limit) {
      const data = groupBy(rows, keyFn).sort((a, b) => {
        if (sortBy === "orders") return b.orders - a.orders || b.commission - a.commission;
        if (sortBy === "orderAmount") return b.orderAmount - a.orderAmount || b.commission - a.commission;
        return b.commission - a.commission || b.orders - a.orders;
      });
      return limit === "all" ? data : data.slice(0, Number(limit));
    }

    function unique(values) { return [...new Set(values.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), "zh-CN")); }

    function fillSelect(id, values, placeholder) {
      const el = document.getElementById(id);
      el.innerHTML = placeholder ? '<option value="">' + placeholder + '</option>' : "";
      values.forEach(value => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = value;
        el.appendChild(option);
      });
    }

    function fillLimit(id, value) {
      const el = document.getElementById(id);
      el.innerHTML = limits.map(limit => '<option value="' + limit + '">' + (limit === "all" ? "所有" : limit) + '</option>').join("");
      el.value = String(value);
    }

    function setupControls() {
      document.getElementById("startDate").value = state.startDate;
      document.getElementById("endDate").value = state.endDate;
      fillSelect("siteFilter", unique(payload.rawRows.map(r => r.site)), "全部站点");
      fillSelect("teamFilter", unique(payload.rawRows.map(r => r.team)), "全部团队");
      fillSelect("accountFilter", unique(payload.rawRows.map(r => r.account)), "全部达人");
      fillLimit("accountLimit", state.accountLimit);
      fillLimit("productLimit", state.productLimit);
      document.getElementById("productIdSearch").value = state.productIdSearch;
      updateTrendOptions();
    }

    function updateTrendOptions() {
      const rows = filteredRows(false);
      const accounts = rankData(rows, r => r.account, "commission", 100).map(d => d.key);
      let products = rankData(rows, r => r.productId + "｜" + r.productName, "commission", "all").map(d => d.key);
      const productQuery = state.productIdSearch.trim();
      if (productQuery) {
        products = products.filter(key => key.split("｜")[0].includes(productQuery)).slice(0, 200);
      } else {
        products = products.slice(0, 100);
      }
      if (!state.accountTrend || !accounts.includes(state.accountTrend)) state.accountTrend = accounts[0] || "";
      if (!state.productTrend || !products.includes(state.productTrend)) state.productTrend = products[0] || "";
      fillSelect("accountTrendSelect", accounts, "选择达人");
      fillSelect("productTrendSelect", products, productQuery ? "无匹配商品" : "选择商品");
      document.getElementById("accountTrendSelect").value = state.accountTrend;
      document.getElementById("productTrendSelect").value = state.productTrend;
    }

    function renderKpis(rows) {
      const s = summarize(rows);
      const days = daily(rows).length || 1;
      document.getElementById("kpis").innerHTML = [
        ["订单数", moneyFmt.format(s.orders), "按订单明细行计算，含同订单多 SKU"],
        ["订单GMV", money(s.orderAmount), "原始订单总金额"],
        ["实际佣金", money(s.commission), "统一换算人民币"],
        ["佣金率", share(s.commissionRate), "实际佣金 / 订单GMV"],
        ["日均订单", fmt(s.orders / days), "按有出单日期计算"],
        ["单均GMV", money(s.avgOrderAmount), "订单GMV / 订单数"],
        ["单均佣金", money(s.avgCommission), "实际佣金 / 订单数"],
        ["达人账号", moneyFmt.format(s.accounts), "筛选范围内有出单账号"],
      ].map(([label, value, hint]) => '<article class="panel metric"><div class="label">' + label + '</div><div class="value">' + value + '</div><div class="hint">' + hint + '</div></article>').join("");
    }

    function renderInsights(rows) {
      const days = daily(rows);
      const recent = bucket(days.slice(-14));
      const previous = bucket(days.slice(-28, -14));
      const accounts = rankData(rows, r => r.account, "commission", 5);
      const products = rankData(rows, r => r.productId + "｜" + r.productName, "commission", 5);
      const site = rankData(rows, r => r.site, "commission", 1)[0];
      const total = summarize(rows);
      const accShare = accounts[0] && total.commission ? accounts[0].commission / total.commission : 0;
      document.getElementById("insights").innerHTML = [
        ["近期增长", "近 14 天日均订单 " + fmt(recent.avgOrders) + "，较前 14 天 " + pct(growth(recent.avgOrders, previous.avgOrders)) + "；日均GMV " + money(recent.avgOrderAmount) + "，日均佣金 " + money(recent.avgCommission) + "。"],
        ["头部达人", (accounts[0]?.key || "-") + " 贡献佣金 " + money(accounts[0]?.commission || 0) + "，GMV " + money(accounts[0]?.orderAmount || 0) + "，占筛选范围佣金 " + share(accShare) + "。"],
        ["头部商品", (products[0]?.key || "-").slice(0, 56) + "，贡献 GMV " + money(products[0]?.orderAmount || 0) + "，佣金 " + money(products[0]?.commission || 0) + "。"],
        ["市场重心", "当前最高收入站点是 " + (site?.key || "-") + "，GMV " + money(site?.orderAmount || 0) + "，佣金 " + money(site?.commission || 0) + "，订单 " + moneyFmt.format(site?.orders || 0) + "。"],
      ].map(([title, text]) => '<div class="panel insight"><strong>' + esc(title) + '</strong><p>' + esc(text) + '</p></div>').join("");
    }

    function bucket(days) {
      const orders = days.reduce((sum, d) => sum + d.orders, 0);
      const commission = days.reduce((sum, d) => sum + d.commission, 0);
      const orderAmount = days.reduce((sum, d) => sum + d.orderAmount, 0);
      return { avgOrders: days.length ? orders / days.length : 0, avgCommission: days.length ? commission / days.length : 0, avgOrderAmount: days.length ? orderAmount / days.length : 0 };
    }

    function growth(current, previous) {
      return previous ? (current - previous) / previous : null;
    }

    function renderTables(rows) {
      const accountData = rankData(rows, r => r.account, state.accountSort, state.accountLimit);
      const productData = rankData(rows, r => r.productId + "｜" + r.productName, state.productSort, state.productLimit);
      document.getElementById("accountTitle").textContent = "达人收入 Top " + (state.accountLimit === "all" ? "所有" : state.accountLimit);
      document.getElementById("productTitle").textContent = "商品收入 Top " + (state.productLimit === "all" ? "所有" : state.productLimit);
      renderRank("accountTable", accountData, "达人账号", state.accountSort, true);
      renderRank("productTable", productData, "商品", state.productSort, true);
      renderRank("teamTable", rankData(rows, r => r.team, "commission", "all"), "团队", "commission");
      renderRank("siteTable", rankData(rows, r => r.site, "commission", "all"), "站点", "commission");
      renderDetails(rows);
    }

    function renderRank(id, data, firstTitle, sortBy, scroll = false) {
      const total = data.reduce((sum, d) => sum + (sortBy === "orders" ? d.orders : sortBy === "orderAmount" ? d.orderAmount : d.commission), 0) || 1;
      const rows = data.map((d, i) => {
        const rawName = String(d.key || "");
        const name = rawName.length > 76 ? rawName.slice(0, 76) + "..." : rawName;
        const base = sortBy === "orders" ? d.orders : sortBy === "orderAmount" ? d.orderAmount : d.commission;
        return '<tr><td class="rank">' + (i + 1) + '</td><td><div class="name" title="' + esc(rawName) + '">' + esc(name) + '</div><div class="progress"><span style="width:' + Math.max(2, base / total * 100) + '%"></span></div></td><td class="num">' + money(d.orderAmount) + '</td><td class="num">' + money(d.commission) + '</td><td class="num">' + moneyFmt.format(d.orders) + '</td><td class="num">' + money(d.avgCommission) + '</td></tr>';
      }).join("");
      const table = '<table><thead><tr><th class="rank">#</th><th>' + firstTitle + '</th><th class="num">GMV</th><th class="num">佣金</th><th class="num">订单</th><th class="num">单均佣金</th></tr></thead><tbody>' + rows + '</tbody></table>';
      document.getElementById(id).innerHTML = scroll ? '<div class="rank-scroll">' + table + '</div>' : table;
    }

    function renderDetails(rows) {
      const recent = [...rows].sort((a, b) => String(b.orderTime).localeCompare(String(a.orderTime))).slice(0, 300);
      const trs = recent.map(r => '<tr><td>' + esc(r.orderDate) + '</td><td>' + esc(typeof r.orderHour === "number" ? hourLabel(r.orderHour) : "-") + '</td><td>' + esc(r.site) + '</td><td>' + esc(r.account) + '</td><td><div class="name" title="' + esc(r.productName) + '">' + esc(r.productName) + '</div></td><td class="num">' + money(r.orderAmount) + '</td><td class="num">' + money(r.actualCommissionCny) + '</td><td class="num">' + esc(r.orderId) + '</td></tr>').join("");
      document.getElementById("detailTable").innerHTML = '<table><thead><tr><th>日期</th><th>时段</th><th>站点</th><th>达人</th><th>商品</th><th class="num">GMV</th><th class="num">佣金</th><th class="num">订单号</th></tr></thead><tbody>' + trs + '</tbody></table>';
    }

    function exportRank(kind) {
      const rows = filteredRows();
      const isAccount = kind === "account";
      const sortBy = isAccount ? state.accountSort : state.productSort;
      const limit = isAccount ? state.accountLimit : state.productLimit;
      const title = isAccount ? "达人收入排序" : "商品收入排序";
      const data = isAccount
        ? rankData(rows, r => r.account, sortBy, limit)
        : rankData(rows, r => r.productId + "｜" + r.productName, sortBy, limit);
      const headers = [isAccount ? "达人账号" : "商品", "订单GMV", "佣金人民币", "订单数", "订单记录数", "单均GMV", "单均佣金", "佣金率", "占筛选佣金", "排序方式", "开始日期", "结束日期", "站点筛选", "团队筛选", "达人筛选"];
      const totalCommission = data.reduce((sum, d) => sum + d.commission, 0) || 1;
      const bodyRows = data.map(d => [
        d.key,
        Number(d.orderAmount || 0).toFixed(2),
        Number(d.commission || 0).toFixed(2),
        d.orders,
        d.records,
        Number(d.avgOrderAmount || 0).toFixed(2),
        Number(d.avgCommission || 0).toFixed(2),
        (Number(d.commission || 0) / Math.max(1, Number(d.orderAmount || 0)) * 100).toFixed(2) + "%",
        (d.commission / totalCommission * 100).toFixed(2) + "%",
        sortBy === "orders" ? "订单排序" : sortBy === "orderAmount" ? "GMV排序" : "佣金排序",
        state.startDate,
        state.endDate,
        state.site || "全部",
        state.team || "全部",
        state.account || "全部",
      ]);
      downloadExcel(title, headers, bodyRows);
    }

    function downloadExcel(sheetName, headers, rows) {
      const table = '<table><thead><tr>' + headers.map(h => '<th>' + esc(h) + '</th>').join("") + '</tr></thead><tbody>' +
        rows.map(row => '<tr>' + row.map(cell => '<td>' + esc(cell) + '</td>').join("") + '</tr>').join("") +
        '</tbody></table>';
      const html = '<html><head><meta charset="utf-8"></head><body>' + table + '</body></html>';
      const blob = new Blob(["\ufeff", html], { type: "application/vnd.ms-excel;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = sheetName + "_" + state.startDate + "_" + state.endDate + ".xls";
      document.body.appendChild(a);
      a.click();
      URL.revokeObjectURL(a.href);
      a.remove();
    }

    function renderCharts(rows) {
      drawLineChart(document.getElementById("trendChart"), daily(rows), { focus: false });
      drawBarChart(document.getElementById("siteChart"), rankData(rows, r => r.site, "commission", 8));
      drawLineChart(document.getElementById("hourTrendChart"), hourly(rows), { focus: false, labelSuffix: "点" });
      drawHeatmap(document.getElementById("hourHeatmap"), heatmapBuckets(rows));
      const accountRows = rows.filter(r => r.account === state.accountTrend);
      const productRows = rows.filter(r => (r.productId + "｜" + r.productName) === state.productTrend);
      drawLineChart(document.getElementById("accountTrendChart"), daily(accountRows), { focus: true, empty: "请选择达人" });
      drawLineChart(document.getElementById("productTrendChart"), daily(productRows), { focus: true, empty: "请选择商品" });
    }

    function drawLineChart(svg, data, opts = {}) {
      svg.innerHTML = "";
      const width = svg.clientWidth || 760;
      const height = svg.clientHeight || 330;
      const pad = { l: 56, r: 58, t: 18, b: 42 };
      svg.setAttribute("viewBox", "0 0 " + width + " " + height);
      if (!data.length) { addText(svg, width / 2, height / 2, opts.empty || "暂无数据", "middle", "var(--muted)"); return; }
      const x = i => pad.l + (data.length === 1 ? 0 : i * (width - pad.l - pad.r) / (data.length - 1));
      const maxOrders = Math.max(...data.map(d => d.orders), 1);
      const maxCom = Math.max(...data.map(d => d.commission), 1);
      const yOrders = v => height - pad.b - v / maxOrders * (height - pad.t - pad.b);
      const yCom = v => height - pad.b - v / maxCom * (height - pad.t - pad.b);
      addGrid(svg, width, height, pad);
      const orderPath = data.map((d, i) => (i ? "L" : "M") + x(i) + "," + yOrders(d.orders)).join(" ");
      svg.insertAdjacentHTML("beforeend", '<path class="' + (opts.focus ? "line-focus" : "line-orders") + '" d="' + orderPath + '"></path>');
      if (!opts.focus) {
        const comPath = data.map((d, i) => (i ? "L" : "M") + x(i) + "," + yCom(d.commission)).join(" ");
        svg.insertAdjacentHTML("beforeend", '<path class="line-commission" d="' + comPath + '"></path>');
      }
      const ticks = Math.min(6, data.length);
      for (let i = 0; i < ticks; i++) {
        const idx = Math.round(i * (data.length - 1) / Math.max(1, ticks - 1));
        const label = typeof data[idx].hour === "number" ? String(data[idx].hour) + (opts.labelSuffix || "") : data[idx].date.slice(5);
        addText(svg, x(idx), height - 14, label, "middle", "var(--muted)");
      }
      addText(svg, pad.l, 13, "订单 max " + moneyFmt.format(maxOrders), "start", opts.focus ? "var(--violet)" : "var(--blue)");
      if (!opts.focus) addText(svg, width - pad.r, 13, "佣金 max " + money(maxCom), "end", "var(--green)");
      const hit = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      hit.setAttribute("x", pad.l);
      hit.setAttribute("y", pad.t);
      hit.setAttribute("width", width - pad.l - pad.r);
      hit.setAttribute("height", height - pad.t - pad.b);
      hit.setAttribute("fill", "transparent");
      hit.style.cursor = "crosshair";
      hit.addEventListener("mousemove", event => {
        const point = svgPoint(svg, event);
        const ratio = Math.max(0, Math.min(1, (point.x - pad.l) / Math.max(1, width - pad.l - pad.r)));
        const idx = Math.round(ratio * (data.length - 1));
        const d = data[idx];
        showTooltip(event, opts.focus
          ? '<strong>' + esc(d.date) + '</strong>订单：' + moneyFmt.format(d.orders) + '<br>GMV：' + money(d.orderAmount) + '<br>佣金：' + money(d.commission)
          : '<strong>' + esc(d.date) + '</strong>订单：' + moneyFmt.format(d.orders) + '<br>GMV：' + money(d.orderAmount) + '<br>佣金：' + money(d.commission) + '<br>单均佣金：' + money(d.avgCommission));
      });
      hit.addEventListener("mouseleave", hideTooltip);
      svg.appendChild(hit);
    }

    function drawHeatmap(container, rows) {
      if (!rows.length) {
        container.innerHTML = '<div class="caption" style="padding:18px;">暂无时间维度数据</div>';
        return;
      }
      const maxOrders = Math.max(...rows.flatMap(day => day.hours.map(hour => hour.orders)), 1);
      const header = '<div class="heat-corner">日期</div>' + Array.from({ length: 24 }, (_, hour) => '<div class="heat-hour">' + hour + '</div>').join("");
      const body = rows.map(day => {
        const cells = day.hours.map(hour => {
          const intensity = hour.orders / maxOrders;
          const alpha = Math.max(.08, intensity * .88);
          const color = 'rgba(37, 99, 235, ' + alpha.toFixed(3) + ')';
          const title = day.date + " " + hour.label + "\\n订单：" + hour.orders + "\\nGMV：" + money(hour.orderAmount) + "\\n佣金：" + money(hour.commission);
          return '<div class="heat-cell" data-date="' + esc(day.date) + '" data-hour="' + hour.hour + '" data-orders="' + hour.orders + '" data-gmv="' + Number(hour.orderAmount || 0).toFixed(2) + '" data-commission="' + Number(hour.commission || 0).toFixed(2) + '" title="' + esc(title) + '" style="background:' + color + '"></div>';
        }).join("");
        return '<div class="heat-row-label" title="' + esc(day.date) + '">' + esc(day.date.slice(5)) + '</div>' + cells;
      }).join("");
      container.innerHTML = '<div class="heatmap-grid">' + header + body + '</div>';
      container.querySelectorAll(".heat-cell").forEach(cell => {
        cell.addEventListener("mousemove", event => {
          showTooltip(event, '<strong>' + esc(cell.dataset.date) + " " + esc(hourLabel(Number(cell.dataset.hour))) + '</strong>订单：' + moneyFmt.format(cell.dataset.orders) + '<br>GMV：' + money(cell.dataset.gmv) + '<br>佣金：' + money(cell.dataset.commission));
        });
        cell.addEventListener("mouseleave", hideTooltip);
      });
    }

    function drawBarChart(svg, data) {
      svg.innerHTML = "";
      const width = svg.clientWidth || 440;
      const height = svg.clientHeight || 330;
      const pad = { l: 72, r: 74, t: 20, b: 34 };
      svg.setAttribute("viewBox", "0 0 " + width + " " + height);
      if (!data.length) return;
      const max = Math.max(...data.map(d => d.commission), 1);
      const rowH = (height - pad.t - pad.b) / data.length;
      data.forEach((d, i) => {
        const y = pad.t + i * rowH;
        const w = (width - pad.l - pad.r) * d.commission / max;
        const label = money(d.commission);
        const outsideX = pad.l + w + 6;
        const useInside = outsideX > width - pad.r + 20;
        const labelX = useInside ? Math.max(pad.l + 8, pad.l + w - 8) : Math.min(outsideX, width - 8);
        const labelAnchor = useInside ? "end" : "start";
        const labelColor = useInside ? "#fff" : "var(--ink)";
        svg.insertAdjacentHTML("beforeend", '<rect class="bar' + (i % 2 ? " alt" : "") + '" x="' + pad.l + '" y="' + (y + 5) + '" width="' + Math.max(2, w) + '" height="' + Math.max(8, rowH - 10) + '" rx="3"></rect>');
        addText(svg, pad.l - 8, y + rowH / 2 + 4, d.key, "end", "var(--muted)");
        addText(svg, labelX, y + rowH / 2 + 4, label, labelAnchor, labelColor);
        const hit = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        hit.setAttribute("x", pad.l);
        hit.setAttribute("y", y);
        hit.setAttribute("width", width - pad.l - pad.r);
        hit.setAttribute("height", rowH);
        hit.setAttribute("fill", "transparent");
        hit.style.cursor = "default";
        hit.addEventListener("mousemove", event => {
          showTooltip(event, '<strong>' + esc(d.key) + '</strong>GMV：' + money(d.orderAmount) + '<br>佣金：' + money(d.commission) + '<br>订单：' + moneyFmt.format(d.orders) + '<br>单均佣金：' + money(d.avgCommission));
        });
        hit.addEventListener("mouseleave", hideTooltip);
        svg.appendChild(hit);
      });
    }

    function svgPoint(svg, event) {
      const pt = svg.createSVGPoint();
      pt.x = event.clientX;
      pt.y = event.clientY;
      return pt.matrixTransform(svg.getScreenCTM().inverse());
    }

    function showTooltip(event, html) {
      const tip = document.getElementById("chartTooltip");
      tip.innerHTML = html;
      tip.style.display = "block";
      const margin = 14;
      const rect = tip.getBoundingClientRect();
      let x = event.clientX + margin;
      let y = event.clientY + margin;
      if (x + rect.width > window.innerWidth - 8) x = event.clientX - rect.width - margin;
      if (y + rect.height > window.innerHeight - 8) y = event.clientY - rect.height - margin;
      tip.style.left = Math.max(8, x) + "px";
      tip.style.top = Math.max(8, y) + "px";
    }

    function hideTooltip() {
      document.getElementById("chartTooltip").style.display = "none";
    }

    function addGrid(svg, width, height, pad) {
      for (let i = 0; i <= 4; i++) {
        const y = pad.t + i * (height - pad.t - pad.b) / 4;
        svg.insertAdjacentHTML("beforeend", '<line x1="' + pad.l + '" x2="' + (width - pad.r) + '" y1="' + y + '" y2="' + y + '" stroke="var(--line)" stroke-width="1"></line>');
      }
      svg.insertAdjacentHTML("beforeend", '<rect x="' + pad.l + '" y="' + pad.t + '" width="' + (width - pad.l - pad.r) + '" height="' + (height - pad.t - pad.b) + '" fill="none" stroke="var(--line)"></rect>');
    }

    function addText(svg, x, y, text, anchor, fill) {
      const node = document.createElementNS("http://www.w3.org/2000/svg", "text");
      node.setAttribute("x", x);
      node.setAttribute("y", y);
      node.setAttribute("text-anchor", anchor);
      node.setAttribute("fill", fill);
      node.setAttribute("font-size", "11");
      node.textContent = text;
      svg.appendChild(node);
    }

    function esc(value) {
      return String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
    }

    function currentProject() {
      return projects.find(project => project.id === state.projectId) || projects[0];
    }

    function accessKey(projectId) {
      return "tkDashboardAccess:" + projectId;
    }

    function codeKey(projectId) {
      return "tkDashboardCode:" + projectId;
    }

    function savedCode() {
      return sessionStorage.getItem(codeKey(state.projectId)) || "";
    }

    function renderProjectCards() {
      const grid = document.getElementById("projectGrid");
      grid.innerHTML = projects.map(project =>
        '<button type="button" class="project-card' + (project.id === state.projectId ? " active" : "") + '" data-project-id="' + esc(project.id) + '">' +
        '<strong>' + esc(project.name) + '</strong><span>' + esc(project.description) + '</span></button>'
      ).join("");
      const project = currentProject();
      document.getElementById("selectedProjectText").textContent = project ? "当前选择：" + project.name + "。请输入该项目卡密。" : "请选择项目，并输入对应卡密。";
      grid.querySelectorAll(".project-card").forEach(button => {
        button.addEventListener("click", () => {
          state.projectId = button.dataset.projectId;
          document.getElementById("accessCode").value = savedCode();
          renderProjectCards();
        });
      });
    }

    function showProjectPortal() {
      document.body.classList.add("locked");
      document.getElementById("authOverlay").style.display = "block";
      document.getElementById("accessCode").value = savedCode();
      document.getElementById("authError").textContent = "";
      renderProjectCards();
    }

    function unlockDashboard() {
      document.body.classList.remove("locked");
      document.getElementById("authOverlay").style.display = "none";
    }

    async function submitAccessCode(event) {
      event.preventDefault();
      const input = document.getElementById("accessCode");
      const btn = document.getElementById("authBtn");
      const error = document.getElementById("authError");
      const code = input.value.trim();
      if (!code) {
        error.textContent = "请输入卡密";
        return;
      }
      btn.disabled = true;
      error.textContent = "";
      try {
        const res = await fetch("/api/auth", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ projectId: state.projectId, code }),
        });
        const json = await res.json();
        if (!json.ok) throw new Error(json.error || "卡密错误");
        sessionStorage.setItem(accessKey(state.projectId), "ok");
        sessionStorage.setItem(codeKey(state.projectId), code);
        unlockDashboard();
        refreshData(state.projectId);
      } catch (err) {
        sessionStorage.removeItem(accessKey(state.projectId));
        sessionStorage.removeItem(codeKey(state.projectId));
        error.textContent = err.message || "卡密错误";
        input.select();
      } finally {
        btn.disabled = false;
      }
    }

    async function refreshData(projectId = state.projectId) {
      const btn = document.getElementById("refreshBtn");
      const status = document.getElementById("refreshStatus");
      const code = sessionStorage.getItem(codeKey(projectId));
      if (!code) {
        showProjectPortal();
        return;
      }
      btn.disabled = true;
      status.textContent = "正在拉取飞书最新数据...";
      try {
        const res = await fetch("/api/refresh?project=" + encodeURIComponent(projectId), {
          method: "POST",
          headers: { "x-dashboard-code": code },
        });
        const json = await res.json();
        if (!json.ok) throw new Error(json.error || "refresh failed");
        payload = json.payload;
        Object.assign(state, {
          projectId: payload.source.projectId || projectId,
          startDate: payload.dateRange.startLocal,
          endDate: payload.dateRange.endLocal,
          site: "",
          team: "",
          account: "",
          search: "",
          accountTrend: "",
          productTrend: "",
          productIdSearch: "",
        });
        const project = currentProject();
        document.getElementById("currentProjectName").textContent = project?.name || payload.source.projectName || "当前项目";
        document.querySelector(".sub").textContent = "当前项目：" + (payload.source.projectName || project?.name || "-") + "｜数据源：" + payload.source.tableName + "｜" + payload.dateRange.startLocal + " 至 " + payload.dateRange.endLocal + "｜生成时间：" + new Date(payload.generatedAt).toLocaleString("zh-CN", { hour12: false });
        const nextUrl = new URL(location.href);
        nextUrl.searchParams.set("project", state.projectId);
        history.replaceState(null, "", nextUrl);
        setupControls();
        render();
        status.textContent = "刷新完成：" + moneyFmt.format(payload.source.records) + " 条记录";
      } catch (err) {
        if (/卡密/.test(err.message || "")) {
          sessionStorage.removeItem(accessKey(projectId));
          sessionStorage.removeItem(codeKey(projectId));
          showProjectPortal();
        }
        if (/Data not ready|try again later/i.test(err.message || "")) {
          status.textContent = "飞书数据准备中，请 30 秒后再刷新";
        } else {
          status.textContent = "刷新失败：" + (err.message || "请稍后重试");
          alert("刷新失败：" + (err.message || "请稍后重试"));
        }
      } finally {
        btn.disabled = false;
      }
    }

    function render() {
      const rows = filteredRows();
      updateTrendOptions();
      renderKpis(rows);
      renderInsights(rows);
      renderCharts(rows);
      renderTables(rows);
    }

    document.getElementById("startDate").addEventListener("change", e => { state.startDate = e.target.value; render(); });
    document.getElementById("endDate").addEventListener("change", e => { state.endDate = e.target.value; render(); });
    document.getElementById("siteFilter").addEventListener("change", e => { state.site = e.target.value; render(); });
    document.getElementById("teamFilter").addEventListener("change", e => { state.team = e.target.value; render(); });
    document.getElementById("accountFilter").addEventListener("change", e => { state.account = e.target.value; render(); });
    document.getElementById("accountSort").addEventListener("change", e => { state.accountSort = e.target.value; render(); });
    document.getElementById("productSort").addEventListener("change", e => { state.productSort = e.target.value; render(); });
    document.getElementById("accountLimit").addEventListener("change", e => { state.accountLimit = e.target.value; render(); });
    document.getElementById("productLimit").addEventListener("change", e => { state.productLimit = e.target.value; render(); });
    document.getElementById("exportAccount").addEventListener("click", () => exportRank("account"));
    document.getElementById("exportProduct").addEventListener("click", () => exportRank("product"));
    document.getElementById("accountTrendSelect").addEventListener("change", e => { state.accountTrend = e.target.value; renderCharts(filteredRows()); });
    document.getElementById("productTrendSelect").addEventListener("change", e => { state.productTrend = e.target.value; renderCharts(filteredRows()); });
    document.getElementById("productIdSearch").addEventListener("input", e => {
      state.productIdSearch = e.target.value.replace(/\\D/g, "");
      e.target.value = state.productIdSearch;
      updateTrendOptions();
      renderCharts(filteredRows());
    });
    document.getElementById("searchInput").addEventListener("input", e => { state.search = e.target.value; render(); });
    document.getElementById("resetFilters").addEventListener("click", () => {
      Object.assign(state, { startDate: payload.dateRange.startLocal, endDate: payload.dateRange.endLocal, site: "", team: "", account: "", search: "" });
      document.getElementById("startDate").value = state.startDate;
      document.getElementById("endDate").value = state.endDate;
      document.getElementById("siteFilter").value = "";
      document.getElementById("teamFilter").value = "";
      document.getElementById("accountFilter").value = "";
      document.getElementById("searchInput").value = "";
      render();
    });
    document.getElementById("refreshBtn").addEventListener("click", refreshData);
    document.getElementById("switchProjectBtn").addEventListener("click", showProjectPortal);
    document.getElementById("authForm").addEventListener("submit", submitAccessCode);
    window.addEventListener("resize", () => renderCharts(filteredRows()));

    renderProjectCards();
    document.getElementById("currentProjectName").textContent = currentProject()?.name || "当前项目";
    if (sessionStorage.getItem(accessKey(state.projectId)) === "ok") {
      unlockDashboard();
      refreshData(state.projectId);
    } else {
      showProjectPortal();
    }
    setupControls();
    render();
  </script>
</body>
</html>`;
}

async function loadPayload(projectId = "main") {
  const project = getProject(projectId);
  const result = await listRecords(project);
  return buildPayload(result.rows, project, { usedView: result.usedView });
}

async function buildDashboard() {
  const payload = emptyPayload(getProject("main"));
  return { html: renderHtml(payload), payload, records: payload.source.records, generatedAt: payload.generatedAt };
}

if (require.main === module) {
  buildDashboard()
    .then((result) => console.log(JSON.stringify({ ok: true, records: result.records, generatedAt: result.generatedAt }, null, 2)))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = { buildDashboard, loadPayload, renderHtml, publicProjects, getProject, verifyProjectCode };
