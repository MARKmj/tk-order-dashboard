#!/usr/bin/env node

const { loadPayload, projectIds } = require("../lib/dashboard");
const { writeSnapshot, statusFromSnapshot } = require("../lib/cache");

async function syncProject(projectId) {
  const payload = await loadPayload(projectId);
  const snapshot = await writeSnapshot(projectId, payload, { trigger: "github-actions" });
  return statusFromSnapshot(snapshot);
}

async function main() {
  const selectedProject = process.argv[2];
  const targets = selectedProject ? [selectedProject] : projectIds();
  const results = [];

  for (const projectId of targets) {
    try {
      const startedAt = Date.now();
      const status = await syncProject(projectId);
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