const crypto = require("crypto");
const { readNamedCache, writeNamedCache } = require("./cache");

const CACHE_NAME = "product-translations";
const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_BATCH_SIZE = 12;
const DEFAULT_SYNC_LIMIT = 60;
const DEFAULT_TIMEOUT_MS = 20000;

function translationConfig() {
  const apiKey = process.env.PRODUCT_TRANSLATION_API_KEY || process.env.OPENAI_API_KEY || "";
  const syncLimitEnv = process.env.PRODUCT_TRANSLATION_SYNC_LIMIT;
  const syncLimit = syncLimitEnv === undefined || syncLimitEnv === ""
    ? DEFAULT_SYNC_LIMIT
    : Number(syncLimitEnv);
  return {
    apiKey,
    baseUrl: (process.env.PRODUCT_TRANSLATION_BASE_URL || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, ""),
    model: process.env.PRODUCT_TRANSLATION_MODEL || process.env.OPENAI_MODEL || DEFAULT_MODEL,
    batchSize: Number(process.env.PRODUCT_TRANSLATION_BATCH_SIZE || DEFAULT_BATCH_SIZE),
    syncLimit: Number.isFinite(syncLimit) ? syncLimit : DEFAULT_SYNC_LIMIT,
    timeoutMs: Number(process.env.PRODUCT_TRANSLATION_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
    enabled: process.env.PRODUCT_TRANSLATION_ENABLED !== "false",
  };
}

function productCacheKey(row) {
  const base = row.productId || row.productName || "";
  return crypto.createHash("sha1").update(String(base).trim()).digest("hex");
}

function productIdentity(row) {
  return {
    key: productCacheKey(row),
    productId: row.productId || "",
    productName: row.productName || "",
  };
}

function cleanText(value, maxLength = 80) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/[|｜]+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function fallbackTitle(item) {
  return cleanText(item.productName || item.productId || "未命名商品", 96);
}

function emptyStore() {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    items: {},
  };
}

async function readStore() {
  const store = await readNamedCache(CACHE_NAME).catch(() => null);
  return store?.items ? store : emptyStore();
}

async function writeStore(store) {
  return writeNamedCache(CACHE_NAME, {
    ...store,
    updatedAt: new Date().toISOString(),
  });
}

function parseJsonContent(content) {
  const text = String(content || "").trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return JSON.parse(fenced ? fenced[1] : text);
}

async function translateBatch(batch, config) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(3000, config.timeoutMs || DEFAULT_TIMEOUT_MS));
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    signal: controller.signal,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: "你是TikTok跨境电商运营分析助手。把商品外文标题改写成简洁中文电商短标题，并补充品类和卖点。只输出JSON。",
        },
        {
          role: "user",
          content: JSON.stringify({
            requirements: [
              "titleCn控制在18到34个中文字符，适合数据看板榜单展示",
              "不要逐字硬翻译，保留关键品类、用途、款式或人群",
              "category使用简短中文品类",
              "sellingPoints给2到4个短词",
              "不要编造品牌、功效或材质",
            ],
            outputShape: {
              items: [
                { key: "原key", titleCn: "中文商品短标题", category: "品类", sellingPoints: ["卖点1", "卖点2"] },
              ],
            },
            products: batch.map((item) => ({
              key: item.key,
              productId: item.productId,
              productName: item.productName,
            })),
          }),
        },
      ],
    }),
  }).finally(() => clearTimeout(timeout));

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || data.message || `translation failed: ${response.status}`);
  const content = data.choices?.[0]?.message?.content || "";
  const parsed = parseJsonContent(content);
  return Array.isArray(parsed.items) ? parsed.items : [];
}

async function translateMissingProducts(missing, store, config) {
  if (!config.enabled || !config.apiKey || missing.length === 0) return { translated: 0, error: "" };
  let translated = 0;
  let error = "";
  const limited = missing.slice(0, Math.max(0, config.syncLimit));
  const batchSize = Math.max(1, Math.min(30, config.batchSize || DEFAULT_BATCH_SIZE));

  for (let i = 0; i < limited.length; i += batchSize) {
    const batch = limited.slice(i, i + batchSize);
    try {
      const items = await translateBatch(batch, config);
      for (const item of items) {
        const source = batch.find((candidate) => candidate.key === item.key);
        if (!source) continue;
        store.items[source.key] = {
          productId: source.productId,
          productName: source.productName,
          titleCn: cleanText(item.titleCn, 96) || fallbackTitle(source),
          category: cleanText(item.category, 30),
          sellingPoints: Array.isArray(item.sellingPoints) ? item.sellingPoints.map((point) => cleanText(point, 18)).filter(Boolean).slice(0, 4) : [],
          source: "ai",
          model: config.model,
          updatedAt: new Date().toISOString(),
        };
        translated += 1;
      }
    } catch (err) {
      error = err.message || "translation failed";
      break;
    }
  }
  return { translated, error };
}

async function enrichProductTranslations(rows) {
  const productsByKey = new Map();
  for (const row of rows) {
    if (!row.productId && !row.productName) continue;
    const item = productIdentity(row);
    if (!productsByKey.has(item.key)) productsByKey.set(item.key, item);
  }

  const products = [...productsByKey.values()];
  const store = await readStore();
  const config = translationConfig();
  const aiCandidates = products.filter((item) => !store.items[item.key]?.titleCn);
  const result = await translateMissingProducts(aiCandidates, store, config);
  if (result.translated) await writeStore(store);

  let applied = 0;
  for (const row of rows) {
    const key = productCacheKey(row);
    const item = store.items[key];
    if (!item?.titleCn) continue;
    row.productNameAiCn = item.titleCn;
    row.productNameCn = item.titleCn || row.productNameCn;
    row.productCategory = item.category || "";
    row.productSellingPoints = item.sellingPoints || [];
    applied += 1;
  }

  return {
    enabled: config.enabled,
    providerReady: Boolean(config.apiKey),
    model: config.apiKey ? config.model : "",
    products: products.length,
    cached: products.filter((item) => store.items[item.key]?.titleCn).length,
    seeded: 0,
    translated: result.translated,
    appliedRows: applied,
    pending: products.filter((item) => !store.items[item.key]?.titleCn).length,
    aiPending: Math.max(0, aiCandidates.length - result.translated),
    error: result.error,
  };
}

module.exports = {
  enrichProductTranslations,
  productCacheKey,
};
