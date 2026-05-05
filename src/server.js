const { createApp } = require('./app');
const { env } = require('./config/env');

const app = createApp();

const server = app.listen(env.port, () => {
  // eslint-disable-next-line no-console
  console.log(`Logora API running on port ${env.port}`);
});

server.requestTimeout = env.serverRequestTimeoutMs;
server.headersTimeout = env.serverHeadersTimeoutMs;
server.keepAliveTimeout = env.serverKeepAliveTimeoutMs;
