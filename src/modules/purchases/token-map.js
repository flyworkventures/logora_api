const { env } = require('../../config/env');

const parseRevenueCatTokenMap = (raw = env.revenueCatTokenMap) => {
  const map = new Map();
  const pairs = String(raw || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

  for (const pair of pairs) {
    const [productId, amountText] = pair.split(':');
    const amount = Number(amountText);
    if (productId && Number.isFinite(amount) && amount > 0) {
      map.set(productId.trim(), amount);
    }
  }
  return map;
};

const parseTokenAmountFromProductId = (productId) => {
  const raw = String(productId || '').trim();
  if (!raw) return null;

  const tokenSegmentMatch = raw.match(/(?:^|[_-])tokens?[_-](\d+)(?:$|[_-])/i);
  if (tokenSegmentMatch) {
    const amount = Number(tokenSegmentMatch[1]);
    return Number.isFinite(amount) && amount > 0 ? amount : null;
  }

  const trailingMatch = raw.match(/(\d+)$/);
  if (trailingMatch) {
    const amount = Number(trailingMatch[1]);
    return Number.isFinite(amount) && amount > 0 ? amount : null;
  }

  return null;
};

const resolveTokenAmount = (productId) => {
  const map = parseRevenueCatTokenMap();
  const mapped = map.get(String(productId || '').trim());
  if (mapped) return mapped;
  return parseTokenAmountFromProductId(productId);
};

module.exports = {
  parseRevenueCatTokenMap,
  parseTokenAmountFromProductId,
  resolveTokenAmount,
};
