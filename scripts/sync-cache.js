#!/usr/bin/env node

const { loadPayload, projectIds } = require("../lib/dashboard");
const { writeSnapshot, statusFromSnapshot } = require("../lib/cache");

async function syncProject(projectId) {
  const payload = await loadPayload(projectId);
  const snapshot = await writeSnapshot(projectId, payload, { trigger: "github-actions" });
  return statusFromSnapshot(snapshot);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function syncProjectWithRetry(projectId) {
  const maxAttempts = Number(process.env.SYNC_MAX_ATTEMPTS || 5);
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await syncProject(projectId);
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts) break;
      const delayMs = Math.min(15000 * attempt, 60000);
      console.warn(JSON.stringify({
        ok: false,
        projectId,
        attempt,
        retryInSeconds: Math.round(delayMs / 1000),
        error: error.message || "同步失败",
      }));
      await sleep(delayMs);
    }
  }

  throw lastError;
}

async function main() {
  const selectedProject = process.argv[2];
  const targets = selectedProject ? [selectedProject] : projectIds();
  const results = [];

  for (const projectId of targets) {
    try {
      const startedAt = Date.now();
      const status = await syncProjectWithRetry(projectId);
      results.push({ ok: true, seconds: Math.round((Date.now() - startedAt) / 1000), ...status });
    } catch (error) {
      results.push({ ok: false, projectId, error: error.message || "同步失败" });
    }
  }

  console.log(JSON.stringify({ ok: results.every((item) => item.ok), results }, null, 2));
  if (results.some((item) => !item.ok)) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});