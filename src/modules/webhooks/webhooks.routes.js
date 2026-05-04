const { Router } = require('express');
const { revenueCatWebhook } = require('./webhooks.controller');

const webhooksRouter = Router();

webhooksRouter.post('/revenuecat', revenueCatWebhook);

module.exports = { webhooksRouter };
