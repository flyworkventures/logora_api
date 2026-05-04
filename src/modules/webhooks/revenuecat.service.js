const { randomUUID } = require('crypto');
const { pool } = require('../../db/mysql');
const { env } = require('../../config/env');

const chargeableEventTypes = new Set([
  'INITIAL_PURCHASE',
  'NON_RENEWING_PURCHASE',
  'RENEWAL',
]);

const parseTokenMap = () => {
  const map = new Map();
  const pairs = env.revenueCatTokenMap
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

  for (const pair of pairs) {
    const [productId, tokenText] = pair.split(':');
    const tokens = Number(tokenText);
    if (productId && Number.isFinite(tokens) && tokens > 0) {
      map.set(productId.trim(), tokens);
    }
  }
  return map;
};

const tokenMap = parseTokenMap();

const normalizeEvent = (payload) => {
  const event = payload?.event || payload || {};
  return {
    type: String(event.type || '').trim(),
    appUserId: String(event.app_user_id || event.original_app_user_id || '').trim(),
    productId: String(event.product_id || '').trim(),
    transactionId: String(
      event.transaction_id || event.original_transaction_id || event.id || '',
    ).trim(),
    entitlementIds: Array.isArray(event.entitlement_ids)
      ? event.entitlement_ids.map((x) => String(x))
      : [],
  };
};

const processRevenueCatEvent = async (payload) => {
  const input = normalizeEvent(payload);
  if (!input.type || !input.appUserId || !input.productId || !input.transactionId) {
    const error = new Error('Invalid RevenueCat webhook payload');
    error.statusCode = 400;
    throw error;
  }

  if (!chargeableEventTypes.has(input.type)) {
    return {
      processed: false,
      reason: `Ignored event type: ${input.type}`,
    };
  }

  const hasEntitlement =
    input.entitlementIds.length === 0 ||
    input.entitlementIds.includes(env.revenueCatEntitlementId);
  if (!hasEntitlement) {
    return {
      processed: false,
      reason: `Ignored entitlement: ${input.entitlementIds.join(',')}`,
    };
  }

  const tokenAmount = tokenMap.get(input.productId);
  if (!tokenAmount || tokenAmount <= 0) {
    return {
      processed: false,
      reason: `Unknown product mapping: ${input.productId}`,
    };
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [existingPurchaseRows] = await connection.execute(
      `SELECT id
       FROM purchases
       WHERE transaction_id = ?
       LIMIT 1`,
      [input.transactionId],
    );
    if ((existingPurchaseRows || []).length > 0) {
      await connection.commit();
      return {
        processed: false,
        reason: 'Duplicate transaction',
      };
    }

    const [deviceRows] = await connection.execute(
      `SELECT id, token_balance AS tokenBalance
       FROM devices
       WHERE revenue_cat_user_id = ?
       LIMIT 1`,
      [input.appUserId],
    );

    const device = (deviceRows || [])[0];
    if (!device) {
      const error = new Error(`Device not found for revenueCatUserId: ${input.appUserId}`);
      error.statusCode = 404;
      throw error;
    }

    await connection.execute(
      `INSERT INTO purchases (id, device_id, revenue_cat_user_id, product_id, transaction_id, token_amount, processed)
       VALUES (?, ?, ?, ?, ?, ?, 1)`,
      [
        randomUUID(),
        device.id,
        input.appUserId,
        input.productId,
        input.transactionId,
        tokenAmount,
      ],
    );

    await connection.execute(
      `UPDATE devices
       SET token_balance = token_balance + ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [tokenAmount, device.id],
    );

    await connection.commit();

    return {
      processed: true,
      tokenAmount,
      productId: input.productId,
      transactionId: input.transactionId,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

module.exports = { processRevenueCatEvent };
