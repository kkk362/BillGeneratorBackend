// api/index.js
const app = require('../app');

// Vercel expects a (req, res) handler.
// Express provides one via app:
module.exports = (req, res) => {
  return app(req, res);
};
