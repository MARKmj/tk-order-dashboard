const { loadPayload } = require("../lib/dashboard");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("allow", "POST");
    res.status(405).json({ ok: false, error: "method not allowed" });
    return;
  }

  try {
    const payload = await loadPayload();
    res.setHeader("cache-control", "no-store");
    res.status(200).json({
      ok: true,
      payload,
      records: payload.source.records,
      generatedAt: payload.generatedAt
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};
