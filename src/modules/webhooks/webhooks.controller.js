const { asyncHandler } = require('../../utils/async-handler');
const { env } = require('../../config/env');
const { processRevenueCatEvent } = require('./revenuecat.service');

const revenueCatWebhook = asyncHandler(async (req, res) => {
  const authHeader = String(req.headers.authorization || '').trim();
  if (env.revenueCatWebhookAuth.trim().length > 0) {
    const expected = `Bearer ${env.revenueCatWebhookAuth.trim()}`;
    if (authHeader !== expected) {
      res.status(401).json({ message: 'Unauthorized webhook' });
      return;
    }
  }

  // eslint-disable-next-line no-console
  console.log('[webhooks.revenuecat] payload received');

  try {
    const result = await processRevenueCatEvent(req.body);
    // eslint-disable-next-line no-console
    console.log('[webhooks.revenuecat] processed', result);
    res.status(200).json({ ok: true, ...result });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[webhooks.revenuecat] failed', {
      message: error?.message,
      code: error?.code,
      stack: error?.stack,
    });
    const statusCode = Number(error?.statusCode || 500);
    res.status(statusCode).json({ message: error?.message || 'Webhook failed' });
  }
});

module.exports = { revenueCatWebhook };
