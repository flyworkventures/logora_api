const { z } = require('zod');

const openAuthSchema = z.object({
  deviceId: z.string().trim().min(1, 'deviceId is required'),
  revenueCatUserId: z.string().trim().min(1).optional(),
});

const purchaseSyncSchema = z.object({
  revenueCatUserId: z.string().trim().min(1, 'revenueCatUserId is required'),
  productId: z.string().trim().min(1, 'productId is required'),
  purchaseId: z.string().trim().min(1, 'purchaseId is required'),
});

const notificationDeleteSchema = z.object({
  notificationId: z.string().trim().min(1, 'notificationId is required'),
});

module.exports = { openAuthSchema, purchaseSyncSchema, notificationDeleteSchema };
