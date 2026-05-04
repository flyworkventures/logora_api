const jwt = require('jsonwebtoken');
const { env } = require('../config/env');

const signDeviceToken = (payload) => {
  return jwt.sign(payload, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn,
  });
};

const verifyDeviceToken = (token) => {
  return jwt.verify(token, env.jwtSecret);
};

module.exports = { signDeviceToken, verifyDeviceToken };
