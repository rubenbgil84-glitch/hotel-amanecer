// En desarrollo, Angular reenvía /api al gateway (puerto GATEWAY_PORT del .env).
module.exports = {
  '/api': {
    target: `http://localhost:${process.env.GATEWAY_PORT || 3000}`,
    secure: false,
  },
};
