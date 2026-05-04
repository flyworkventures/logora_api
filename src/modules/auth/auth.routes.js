const { Router } = require('express');
const {
  deleteAllNotificationsAuth,
  deleteNotificationAuth,
  meAuth,
  notificationsAuth,
  openAuth,
  purchaseHistoryAuth,
  purchaseSyncAuth,
} = require('./auth.controller');

const authRouter = Router();

authRouter.post('/open', openAuth);
authRouter.get('/me', ...meAuth);
authRouter.post('/purchase-sync', ...purchaseSyncAuth);
authRouter.get('/purchase-history', ...purchaseHistoryAuth);
authRouter.get('/notifications', ...notificationsAuth);
authRouter.post('/notifications/delete', ...deleteNotificationAuth);
authRouter.post('/notifications/delete-all', ...deleteAllNotificationsAuth);

module.exports = { authRouter };
