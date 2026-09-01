const { publicProjects, verifyProjectCode } = require("../lib/dashboard");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("allow", "POST");
    res.status(405).json({ ok: false, error: "method not allowed" });
    return;
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const result = verifyProjectCode(body.projectId || "main", body.code);
    if (!result.ok) {
      res.status(result.status).json({ ok: false, error: result.error });
      return;
    }
    const project = publicProjects().find((item) => item.id === result.project.id);
    res.setHeader("cache-control", "no-store");
    res.status(200).json({ ok: true, project });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message || "请求格式错误" });
  }
};
