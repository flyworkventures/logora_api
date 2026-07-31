const cors = require('cors');
const express = require('express');
const helmet = require('helmet');
const { authRouter } = require('./modules/auth/auth.routes');
const { chatRouter } = require('./modules/chat/chat.routes');
const { logoRouter } = require('./modules/logo/logo.routes');
const { webhooksRouter } = require('./modules/webhooks/webhooks.routes');
const panelRoutes = require('./routes/panelRoutes');

const createApp = () => {
  const app = express();

  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: '2mb' }));

  app.get('/health', (_req, res) => {
    res.status(200).json({ ok: true });
  });

  app.use('/panel/v1', panelRoutes);
  app.use('/auth', authRouter);
  app.use('/chat', chatRouter);
  app.use('/logo', logoRouter);
  app.use('/webhooks', webhooksRouter);

  app.use((_req, res) => {
    res.status(404).json({ message: 'Route not found' });
  });

  app.use((error, _req, res, _next) => {
    const rawMessage = error instanceof Error ? error.message : '';
    const code = error?.code;
    const isDbConnectionRefused = code === 'ECONNREFUSED';
    const statusCode = isDbConnectionRefused ? 503 : 500;
    const message = rawMessage && rawMessage.trim().length > 0
      ? rawMessage
      : (error?.sqlMessage || error?.code || 'Internal server error');
    const clientMessage = isDbConnectionRefused
      ? 'Database connection refused. Check MySQL service and DATABASE_URL.'
      : message;
    // eslint-disable-next-line no-console
    console.error('[app.error]', {
      message,
      rawMessage,
      code,
      errno: error?.errno,
      sqlState: error?.sqlState,
      sqlMessage: error?.sqlMessage,
      stack: error instanceof Error ? error.stack : undefined,
    });
    res.status(statusCode).json({ message: clientMessage, code });
  });

  return app;
};

module.exports = { createApp };
