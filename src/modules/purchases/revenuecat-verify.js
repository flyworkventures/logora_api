const { env } = require('../../config/env');

const isClientGeneratedPurchaseId = (purchaseId) =>
  String(purchaseId || '').trim().toLowerCase().startsWith('rc_');

/**
 * RevenueCat REST ile abonenin bu transaction'a sahip olduğunu doğrular.
 * Secret yoksa false döner (verify yapılamadı).
 */
const verifyPurchaseWithRevenueCat = async ({
  revenueCatUserId,
  productId,
  transactionId,
}) => {
  const secret = String(env.revenueCatSecretApiKey || '').trim();
  if (!secret) {
    return { verified: false, skipped: true, reason: 'REVENUECAT_SECRET_API_KEY missing' };
  }

  const url = `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(revenueCatUserId)}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
  });

  const raw = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      raw?.message || raw?.error || `RevenueCat verify failed (${response.status})`;
    const error = new Error(message);
    error.statusCode = response.status === 404 ? 404 : 502;
    throw error;
  }

  const nonSubscriptions = raw?.subscriber?.non_subscriptions || {};
  const productPurchases = Array.isArray(nonSubscriptions[productId])
    ? nonSubscriptions[productId]
    : [];

  const matchesTx = (purchase) => {
    const candidates = [
      purchase?.id,
      purchase?.store_transaction_id,
      purchase?.transaction_id,
      purchase?.original_transaction_id,
    ]
      .map((x) => String(x || '').trim())
      .filter(Boolean);
    return candidates.includes(String(transactionId).trim());
  };

  if (productPurchases.some(matchesTx)) {
    return { verified: true, skipped: false };
  }

  // Store product id suffix farkları için tüm consumable'larda ara.
  for (const purchases of Object.values(nonSubscriptions)) {
    if (!Array.isArray(purchases)) continue;
    if (purchases.some(matchesTx)) {
      return { verified: true, skipped: false };
    }
  }

  return {
    verified: false,
    skipped: false,
    reason: 'Transaction not found on RevenueCat subscriber',
  };
};

/**
 * Client sync için güvenlik kapısı.
 * - Sahte rc_* id reddedilir
 * - Secret varsa RC doğrulaması zorunlu
 * - Production'da secret yoksa da client-generated id reddedilir (zaten)
 */
const assertPurchaseSyncAllowed = async ({
  revenueCatUserId,
  productId,
  purchaseId,
}) => {
  if (isClientGeneratedPurchaseId(purchaseId)) {
    const error = new Error('Invalid purchaseId: client-generated ids are not allowed');
    error.statusCode = 400;
    throw error;
  }

  const secret = String(env.revenueCatSecretApiKey || '').trim();
  if (!secret) {
    // eslint-disable-next-line no-console
    console.warn(
      '[purchases.verify] REVENUECAT_SECRET_API_KEY missing; relying on webhook + anti-spoof checks',
    );
    return { verified: false, skipped: true };
  }

  const result = await verifyPurchaseWithRevenueCat({
    revenueCatUserId,
    productId,
    transactionId: purchaseId,
  });

  if (!result.verified) {
    const error = new Error(
      result.reason || 'Purchase could not be verified with RevenueCat',
    );
    error.statusCode = 403;
    throw error;
  }

  return result;
};

module.exports = {
  assertPurchaseSyncAllowed,
  verifyPurchaseWithRevenueCat,
  isClientGeneratedPurchaseId,
};
