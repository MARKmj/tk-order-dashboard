const { loadPayload, projectIds } = require("../lib/dashboard");
const { writeSnapshot, statusFromSnapshot } = require("../lib/cache");

async function syncProject(projectId) {
  const payload = await loadPayload(projectId);
  const snapshot = await writeSnapshot(projectId, payload, { trigger: "cron" });
  return statusFromSnapshot(snapshot);
}

function cleanSecret(value) {
  return String(value || "").trim().replace(/^['"]|['"]$/g, "");
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("allow", "GET, POST");
    res.status(405).json({ ok: false, error: "method not allowed" });
    return;
  }

  const expected = cleanSecret(process.env.CRON_SECRET);
  const auth = cleanSecret(String(req.headers.authorization || "").replace(/^Bearer\s+/i, ""));
  if (!expected) {
    res.status(500).json({ ok: false, error: "服务端未配置 CRON_SECRET" });
    return;
  }
  if (auth !== expected) {
    res.status(401).json({ ok: false, error: "unauthorized" });
    return;
  }

  const startedAt = new Date().toISOString();
  const selectedProject = req.query?.project;
  const targetProjectIds = selectedProject ? [selectedProject] : projectIds();
  const results = [];
  for (const projectId of targetProjectIds) {
    try {
      results.push({ ok: true, ...(await syncProject(projectId)) });
    } catch (error) {
      results.push({ ok: false, projectId, error: error.message || "同步失败" });
    }
  }

  const failed = results.filter((item) => !item.ok);
  res.setHeader("cache-control", "no-store");
  res.status(failed.length ? 207 : 200).json({
    ok: failed.length === 0,
    startedAt,
    finishedAt: new Date().toISOString(),
    results,
  });
};
