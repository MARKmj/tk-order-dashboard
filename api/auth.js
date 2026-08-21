const crypto = require("crypto");

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("allow", "POST");
    res.status(405).json({ ok: false, error: "method not allowed" });
    return;
  }

  const expected = process.env.DASHBOARD_ACCESS_CODE;
  if (!expected) {
    res.status(500).json({ ok: false, error: "服务端未配置卡密" });
    return;
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    if (!safeEqual(body.code, expected)) {
      res.status(401).json({ ok: false, error: "卡密错误" });
      return;
    }
    res.setHeader("cache-control", "no-store");
    res.status(200).json({ ok: true });
  } catch (error) {
    res.status(400).json({ ok: false, error: "请求格式错误" });
  }
};
