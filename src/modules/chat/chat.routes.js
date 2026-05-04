const { Router } = require('express');
const { chatReply } = require('./chat.controller');

const chatRouter = Router();

chatRouter.post('/reply', ...chatReply);

module.exports = { chatRouter };
