const mysql = require('mysql2/promise');
const { env } = require('../config/env');

const poolConfig = env.databaseUrl.trim().length > 0
  ? {
      uri: env.databaseUrl,
      connectionLimit: 10,
      waitForConnections: true,
      namedPlaceholders: true,
    }
  : {
      host: env.dbHost,
      port: env.dbPort,
      user: env.dbUser,
      password: env.dbPassword,
      database: env.dbName,
      connectionLimit: 10,
      waitForConnections: true,
      namedPlaceholders: true,
    };

const pool = mysql.createPool(poolConfig);

module.exports = { pool };
