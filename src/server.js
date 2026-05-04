const { createApp } = require('./app');
const { env } = require('./config/env');

const app = createApp();

app.listen(env.port, () => {
  // eslint-disable-next-line no-console
  console.log(`Logora API running on port ${env.port}`);
});
