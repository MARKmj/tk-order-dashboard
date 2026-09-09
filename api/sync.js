const { loadPayload, verifyProjectCode } = require("../lib/dashboard");
const { writeSnapshot, statusFromSnapshot } = require("../lib/cache");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("allow", "POST");
    res.status(405).json({ ok: false, error: "method not allowed" });
    return;
  }

  try {
    const projectId = req.query?.project || "main";
    const code = req.headers["x-dashboard-code"];
    const auth = verifyProjectCode(projectId, code);
    if (!auth.ok) {
      res.status(auth.status).json({ ok: false, error: auth.error });
      return;
    }

    const payload = await loadPayload(projectId);
    const snapshot = await writeSnapshot(projectId, payload, { trigger: "manual" });
    res.setHeader("cache-control", "no-store");
    res.status(200).json({
      ok: true,
      payload,
      records: payload.source.records,
      generatedAt: payload.generatedAt,
      cache: { hit: true, ...statusFromSnapshot(snapshot) },
    });
  } catch (error) {
    const retryable = /Data not ready|try again later|timeout/i.test(error.message || "");
    res.status(retryable ? 503 : 500).json({
      ok: false,
      retryable,
      error: retryable ? "飞书数据正在计算或接口响应较慢，请稍后重新同步" : error.message
    });
  }
};
