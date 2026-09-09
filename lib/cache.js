const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

let blobApi = null;
try {
  blobApi = require("@vercel/blob");
} catch (_) {
  blobApi = null;
}

const CACHE_PREFIX = process.env.DASHBOARD_CACHE_PREFIX || "tk-order-dashboard";
const LOCAL_CACHE_DIR = path.join(process.cwd(), ".cache");

function cachePath(projectId) {
  return `${CACHE_PREFIX}/${projectId}.json`;
}

function hasBlobStore() {
  return Boolean(blobApi && process.env.BLOB_READ_WRITE_TOKEN);
}

function encryptionSecret() {
  return process.env.DASHBOARD_CACHE_SECRET || process.env.CRON_SECRET || process.env.FEISHU_APP_SECRET || "";
}

function encryptionKey() {
  const secret = encryptionSecret();
  if (!secret && process.env.VERCEL) throw new Error("缓存加密密钥未配置");
  return secret ? crypto.createHash("sha256").update(secret).digest() : null;
}

function encodeSnapshot(snapshot) {
  const key = encryptionKey();
  const text = JSON.stringify(snapshot);
  if (!key) return text;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return JSON.stringify({
    encrypted: true,
    algorithm: "aes-256-gcm",
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: encrypted.toString("base64"),
  });
}

function decodeSnapshot(text) {
  const data = JSON.parse(text);
  if (!data?.encrypted) return data;
  const key = encryptionKey();
  if (!key) throw new Error("缓存加密密钥未配置");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(data.iv, "base64"));
  decipher.setAuthTag(Buffer.from(data.tag, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(data.data, "base64")),
    decipher.final(),
  ]);
  return JSON.parse(decrypted.toString("utf8"));
}

function isLocalRuntime() {
  return !process.env.VERCEL;
}

function statusFromSnapshot(snapshot) {
  return {
    projectId: snapshot?.payload?.source?.projectId || snapshot?.projectId || "",
    generatedAt: snapshot?.payload?.generatedAt || "",
    syncedAt: snapshot?.syncedAt || "",
    records: snapshot?.payload?.source?.records || 0,
    storage: snapshot?.storage || (hasBlobStore() ? "blob" : "local"),
  };
}

async function readFromBlob(projectId) {
  if (!hasBlobStore()) return null;
  try {
    const blob = await blobApi.get(cachePath(projectId), { access: "public", useCache: false });
    if (!blob) return null;
    const text = await new Response(blob.stream).text();
    return decodeSnapshot(text);
  } catch (error) {
    if (/not found|BlobNotFound/i.test(error?.message || error?.name || "")) return null;
    throw error;
  }
}

async function writeToBlob(projectId, snapshot) {
  if (!hasBlobStore()) return null;
  return blobApi.put(cachePath(projectId), encodeSnapshot(snapshot), {
    access: "public",
    contentType: "application/json; charset=utf-8",
    allowOverwrite: true,
  });
}

async function readFromLocal(projectId) {
  if (!isLocalRuntime()) return null;
  try {
    const file = path.join(LOCAL_CACHE_DIR, `${projectId}.json`);
    return decodeSnapshot(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function writeToLocal(projectId, snapshot) {
  if (!isLocalRuntime()) return null;
  await fs.mkdir(LOCAL_CACHE_DIR, { recursive: true });
  const file = path.join(LOCAL_CACHE_DIR, `${projectId}.json`);
  await fs.writeFile(file, encodeSnapshot(snapshot));
  return { pathname: file };
}

async function readSnapshot(projectId) {
  return (await readFromBlob(projectId)) || (await readFromLocal(projectId));
}

async function writeSnapshot(projectId, payload, meta = {}) {
  const snapshot = {
    ok: true,
    projectId,
    syncedAt: new Date().toISOString(),
    storage: hasBlobStore() ? "blob" : "local",
    meta,
    payload,
  };
  const stored = await writeToBlob(projectId, snapshot) || await writeToLocal(projectId, snapshot);
  if (!stored && process.env.VERCEL) {
    throw new Error("缓存存储未配置，请在 Vercel 添加 BLOB_READ_WRITE_TOKEN");
  }
  return { ...snapshot, storageRef: stored?.url || stored?.pathname || "" };
}

module.exports = {
  hasBlobStore,
  readSnapshot,
  writeSnapshot,
  statusFromSnapshot,
};
