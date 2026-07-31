const { env } = require('../../config/env');
const { creditPurchase } = require('../purchases/credit.service');

// Consumable token paketleri için yenileme kredisi yok.
const chargeableEventTypes = new Set([
  'INITIAL_PURCHASE',
  'NON_RENEWING_PURCHASE',
]);

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

  const entitlementId = String(env.revenueCatEntitlementId || '').trim();
  const hasEntitlement =
    !entitlementId ||
    input.entitlementIds.length === 0 ||
    input.entitlementIds.includes(entitlementId);
  if (!hasEntitlement) {
    return {
      processed: false,
      reason: `Ignored entitlement: ${input.entitlementIds.join(',')}`,
    };
  }

  const result = await creditPurchase({
    revenueCatUserId: input.appUserId,
    productId: input.productId,
    transactionId: input.transactionId,
    source: 'webhook',
  });

  return {
    processed: Boolean(result.processed),
    duplicated: Boolean(result.duplicated),
    tokenAmount: result.tokenAmount,
    productId: input.productId,
    transactionId: input.transactionId,
    reason: result.reason,
  };
};

module.exports = { processRevenueCatEvent };
