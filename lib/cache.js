const fs = require("fs/promises");
const path = require("path");

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
    const blob = await blobApi.get(cachePath(projectId), { access: "private", useCache: false });
    if (!blob) return null;
    const text = await new Response(blob.stream).text();
    return JSON.parse(text);
  } catch (error) {
    if (/not found|BlobNotFound/i.test(error?.message || error?.name || "")) return null;
    throw error;
  }
}

async function writeToBlob(projectId, snapshot) {
  if (!hasBlobStore()) return null;
  return blobApi.put(cachePath(projectId), JSON.stringify(snapshot), {
    access: "private",
    contentType: "application/json; charset=utf-8",
    allowOverwrite: true,
  });
}

async function readFromLocal(projectId) {
  if (!isLocalRuntime()) return null;
  try {
    const file = path.join(LOCAL_CACHE_DIR, `${projectId}.json`);
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function writeToLocal(projectId, snapshot) {
  if (!isLocalRuntime()) return null;
  await fs.mkdir(LOCAL_CACHE_DIR, { recursive: true });
  const file = path.join(LOCAL_CACHE_DIR, `${projectId}.json`);
  await fs.writeFile(file, JSON.stringify(snapshot, null, 2));
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
