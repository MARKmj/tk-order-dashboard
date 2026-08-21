const { buildDashboard } = require("../lib/dashboard");

module.exports = async function handler(req, res) {
  try {
    const result = await buildDashboard();
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.setHeader("cache-control", "no-store");
    res.status(200).send(result.html);
  } catch (error) {
    res.setHeader("content-type", "text/plain; charset=utf-8");
    res.status(500).send(`Dashboard render failed: ${error.message}`);
  }
};
