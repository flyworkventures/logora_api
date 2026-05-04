const { Router } = require('express');
const { generateLogo } = require('./logo.controller');

const logoRouter = Router();

logoRouter.post('/generate', ...generateLogo);

module.exports = { logoRouter };
