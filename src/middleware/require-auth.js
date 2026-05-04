const { verifyDeviceToken } = require('../utils/jwt');

const getBearerToken = (authorizationHeader) => {
  if (!authorizationHeader) return null;

  const [scheme, token] = authorizationHeader.split(' ');
  if (scheme !== 'Bearer' || !token) return null;

  return token.trim();
};

const requireAuth = (req, res, next) => {
  const token = getBearerToken(req.headers.authorization);

  if (!token) {
    res.status(401).json({ message: 'Unauthorized' });
    return;
  }

  try {
    req.auth = verifyDeviceToken(token);
    next();
  } catch {
    res.status(401).json({ message: 'Invalid token' });
  }
};

module.exports = { requireAuth };
