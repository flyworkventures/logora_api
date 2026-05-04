const { asyncHandler } = require('../../utils/async-handler');
const { requireAuth } = require('../../middleware/require-auth');
const {
  deleteAllNotifications,
  deleteNotification,
  getCurrentDevice,
  getNotifications,
  getPurchaseHistory,
  openDevice,
  syncPurchase,
} = require('./auth.service');
const { notificationDeleteSchema, openAuthSchema, purchaseSyncSchema } = require('./auth.schemas');

const openAuth = asyncHandler(async (req, res) => {
  // eslint-disable-next-line no-console
  console.log('[auth.controller] /auth/open called', {
    hasBody: Boolean(req.body),
    deviceId: req.body?.deviceId,
  });

  const parsed = openAuthSchema.safeParse(req.body);

  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.error('[auth.controller] invalid body', parsed.error.flatten().fieldErrors);
    res.status(400).json({
      message: 'Invalid request body',
      issues: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  try {
    const result = await openDevice(parsed.data);
    // eslint-disable-next-line no-console
    console.log('[auth.controller] /auth/open success', {
      deviceId: result.deviceId,
      tokenBalance: result.tokenBalance,
      hasAccessToken: Boolean(result.accessToken),
    });
    res.status(200).json(result);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[auth.controller] /auth/open failed', {
      message: error?.message,
      code: error?.code,
      errno: error?.errno,
      sqlState: error?.sqlState,
      sqlMessage: error?.sqlMessage,
      stack: error?.stack,
    });
    throw error;
  }
});

const meAuth = [
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!req.auth) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }

    const device = await getCurrentDevice(req.auth.deviceDbId);

    if (!device) {
      res.status(404).json({ message: 'Device not found' });
      return;
    }

    res.status(200).json(device);
  }),
];

const purchaseSyncAuth = [
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!req.auth?.deviceDbId) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }

    const parsed = purchaseSyncSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        message: 'Invalid request body',
        issues: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const result = await syncPurchase({
      deviceDbId: req.auth.deviceDbId,
      revenueCatUserId: parsed.data.revenueCatUserId,
      productId: parsed.data.productId,
      purchaseId: parsed.data.purchaseId,
    });

    res.status(200).json(result);
  }),
];

const purchaseHistoryAuth = [
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!req.auth?.deviceDbId) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }

    const history = await getPurchaseHistory(req.auth.deviceDbId);
    res.status(200).json({ items: history });
  }),
];

const notificationsAuth = [
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!req.auth?.deviceDbId) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }

    const items = await getNotifications(req.auth.deviceDbId);
    res.status(200).json({ items });
  }),
];

const deleteNotificationAuth = [
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!req.auth?.deviceDbId) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }

    const parsed = notificationDeleteSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        message: 'Invalid request body',
        issues: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const deleted = await deleteNotification({
      deviceDbId: req.auth.deviceDbId,
      notificationId: parsed.data.notificationId,
    });

    res.status(200).json({ deleted });
  }),
];

const deleteAllNotificationsAuth = [
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!req.auth?.deviceDbId) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }

    await deleteAllNotifications(req.auth.deviceDbId);
    res.status(200).json({ ok: true });
  }),
];

module.exports = {
  openAuth,
  meAuth,
  purchaseSyncAuth,
  purchaseHistoryAuth,
  notificationsAuth,
  deleteNotificationAuth,
  deleteAllNotificationsAuth,
};
