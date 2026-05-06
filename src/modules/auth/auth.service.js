const { randomUUID } = require('crypto');
const { pool } = require('../../db/mysql');
const { env } = require('../../config/env');
const { signDeviceToken } = require('../../utils/jwt');

const INITIAL_FREE_TOKEN_BALANCE = 10;

const mapDeviceRow = (row) => ({
  deviceId: row.deviceId,
  revenueCatUserId: row.revenueCatUserId,
  tokenBalance: Number(row.tokenBalance),
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const parseRevenueCatTokenMap = () => {
  const map = new Map();
  const pairs = String(env.revenueCatTokenMap || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  for (const pair of pairs) {
    const [productId, amountText] = pair.split(':');
    const amount = Number(amountText);
    if (productId && Number.isFinite(amount) && amount > 0) {
      map.set(productId.trim(), amount);
    }
  }
  return map;
};

const revenueCatTokenMap = parseRevenueCatTokenMap();

const parseTokenAmountFromProductId = (productId) => {
  const raw = String(productId || '').trim();
  if (!raw) return null;

  // Preferred format: logora_tokens_100 (or token-100 etc.)
  const tokenSegmentMatch = raw.match(/(?:^|[_-])tokens?[_-](\d+)(?:$|[_-])/i);
  if (tokenSegmentMatch) {
    const amount = Number.parseInt(tokenSegmentMatch[1], 10);
    if (Number.isFinite(amount) && amount > 0) return amount;
  }

  // Fallback: any trailing number at the end of productId.
  const trailingNumberMatch = raw.match(/(\d+)$/);
  if (trailingNumberMatch) {
    const amount = Number.parseInt(trailingNumberMatch[1], 10);
    if (Number.isFinite(amount) && amount > 0) return amount;
  }

  return null;
};

const resolveTokenAmount = (productId) => {
  const mapped = revenueCatTokenMap.get(productId);
  if (Number.isFinite(mapped) && mapped > 0) {
    return mapped;
  }
  return parseTokenAmountFromProductId(productId);
};

const createNotification = async ({ connection, deviceId, title, body }) => {
  await connection.execute(
    `INSERT INTO notifications (id, device_id, title, body, is_read)
     VALUES (?, ?, ?, ?, 0)`,
    [randomUUID(), deviceId, title, body],
  );
};

const openDevice = async (input) => {
  const connection = await pool.getConnection();

  try {
    // eslint-disable-next-line no-console
    console.log('[auth.service] openDevice start', {
      deviceId: input?.deviceId,
      hasRevenueCatUserId: Boolean(input?.revenueCatUserId),
    });

    await connection.beginTransaction();

    const deviceId = input.deviceId.trim();
    const revenueCatUserId = input.revenueCatUserId ? input.revenueCatUserId.trim() : null;

    const [rows] = await connection.execute(
      `SELECT id, device_id AS deviceId, revenue_cat_user_id AS revenueCatUserId, token_balance AS tokenBalance, created_at AS createdAt, updated_at AS updatedAt
       FROM devices
       WHERE device_id = ?
       LIMIT 1`,
      [deviceId],
    );

    let device = rows[0] || null;

    if (!device) {
      const devicePrimaryKey = randomUUID();

      await connection.execute(
        `INSERT INTO devices (id, device_id, revenue_cat_user_id, token_balance)
         VALUES (?, ?, ?, ?)`,
        [devicePrimaryKey, deviceId, revenueCatUserId, INITIAL_FREE_TOKEN_BALANCE],
      );

      const [createdRows] = await connection.execute(
        `SELECT id, device_id AS deviceId, revenue_cat_user_id AS revenueCatUserId, token_balance AS tokenBalance, created_at AS createdAt, updated_at AS updatedAt
         FROM devices
         WHERE device_id = ?
         LIMIT 1`,
        [deviceId],
      );

      device = createdRows[0] || null;

      if (device) {
        await createNotification({
          connection,
          deviceId: device.id,
          title: 'Welcome bonus',
          body: `Welcome to Logora! ${INITIAL_FREE_TOKEN_BALANCE} free tokens were added to your balance.`,
        });
      }
    } else if (revenueCatUserId && device.revenueCatUserId !== revenueCatUserId) {
      await connection.execute(
        `UPDATE devices
         SET revenue_cat_user_id = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [revenueCatUserId, device.id],
      );

      const [updatedRows] = await connection.execute(
        `SELECT id, device_id AS deviceId, revenue_cat_user_id AS revenueCatUserId, token_balance AS tokenBalance, created_at AS createdAt, updated_at AS updatedAt
         FROM devices
         WHERE id = ?
         LIMIT 1`,
        [device.id],
      );

      device = updatedRows[0] || device;
    }

    if (!device) {
      throw new Error('Device record could not be created');
    }

    await connection.commit();

    // eslint-disable-next-line no-console
    console.log('[auth.service] openDevice commit success', {
      deviceId: device.deviceId,
      tokenBalance: Number(device.tokenBalance),
    });

    return {
      deviceId: device.deviceId,
      tokenBalance: Number(device.tokenBalance),
      createdAt: device.createdAt,
      accessToken: signDeviceToken({
        deviceId: device.deviceId,
        deviceDbId: device.id,
      }),
    };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[auth.service] openDevice failed', {
      message: error?.message,
      code: error?.code,
      errno: error?.errno,
      sqlState: error?.sqlState,
      sqlMessage: error?.sqlMessage,
      stack: error?.stack,
    });
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const getCurrentDevice = async (deviceDbId) => {
  const [rows] = await pool.execute(
    `SELECT id, device_id AS deviceId, revenue_cat_user_id AS revenueCatUserId, token_balance AS tokenBalance, created_at AS createdAt, updated_at AS updatedAt
     FROM devices
     WHERE id = ?
     LIMIT 1`,
    [deviceDbId],
  );

  const device = rows[0];
  return device ? mapDeviceRow(device) : null;
};

const syncPurchase = async ({
  deviceDbId,
  revenueCatUserId,
  productId,
  purchaseId,
}) => {
  const tokenAmount = resolveTokenAmount(productId);
  if (!tokenAmount) {
    const error = new Error(`Cannot resolve token amount for product: ${productId}`);
    error.statusCode = 400;
    throw error;
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [deviceRows] = await connection.execute(
      `SELECT id, device_id AS deviceId, revenue_cat_user_id AS revenueCatUserId, token_balance AS tokenBalance
       FROM devices
       WHERE id = ?
       LIMIT 1
       FOR UPDATE`,
      [deviceDbId],
    );
    const device = (deviceRows || [])[0];
    if (!device) {
      const error = new Error('Device not found');
      error.statusCode = 404;
      throw error;
    }

    if (!device.revenueCatUserId) {
      await connection.execute(
        `UPDATE devices
         SET revenue_cat_user_id = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [revenueCatUserId, device.id],
      );
    } else if (device.revenueCatUserId !== revenueCatUserId) {
      const error = new Error('RevenueCat user mismatch');
      error.statusCode = 409;
      throw error;
    }

    const [purchaseRows] = await connection.execute(
      `SELECT id
       FROM purchases
       WHERE transaction_id = ?
       LIMIT 1`,
      [purchaseId],
    );
    if ((purchaseRows || []).length > 0) {
      await connection.commit();
      return {
        tokenBalance: Number(device.tokenBalance),
        tokenAmount: 0,
        duplicated: true,
      };
    }

    await connection.execute(
      `INSERT INTO purchases (id, device_id, revenue_cat_user_id, product_id, transaction_id, token_amount, processed)
       VALUES (?, ?, ?, ?, ?, ?, 1)`,
      [randomUUID(), device.id, revenueCatUserId, productId, purchaseId, tokenAmount],
    );

    await connection.execute(
      `UPDATE devices
       SET token_balance = token_balance + ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [tokenAmount, device.id],
    );

    await createNotification({
      connection,
      deviceId: device.id,
      title: 'Purchase completed',
      body: `Your purchase has been synced successfully. +${tokenAmount} tokens added.`,
    });

    const [updatedRows] = await connection.execute(
      `SELECT token_balance AS tokenBalance
       FROM devices
       WHERE id = ?
       LIMIT 1`,
      [device.id],
    );

    await connection.commit();
    return {
      tokenBalance: Number((updatedRows || [])[0]?.tokenBalance || 0),
      tokenAmount,
      duplicated: false,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const getPurchaseHistory = async (deviceDbId) => {
  const [rows] = await pool.execute(
    `SELECT
        product_id AS productId,
        transaction_id AS transactionId,
        token_amount AS tokenAmount,
        created_at AS createdAt
     FROM purchases
     WHERE device_id = ? AND processed = 1
     ORDER BY created_at DESC`,
    [deviceDbId],
  );

  return (rows || []).map((row) => ({
    productId: row.productId,
    transactionId: row.transactionId,
    tokenAmount: Number(row.tokenAmount || 0),
    createdAt: row.createdAt,
  }));
};

const getNotifications = async (deviceDbId) => {
  const [rows] = await pool.execute(
    `SELECT id, title, body, created_at AS createdAt
     FROM notifications
     WHERE device_id = ?
     ORDER BY created_at DESC`,
    [deviceDbId],
  );

  return (rows || []).map((row) => ({
    id: row.id,
    title: row.title,
    body: row.body,
    createdAt: row.createdAt,
  }));
};

const deleteNotification = async ({ deviceDbId, notificationId }) => {
  const [result] = await pool.execute(
    `DELETE FROM notifications
     WHERE id = ? AND device_id = ?`,
    [notificationId, deviceDbId],
  );

  return Number(result?.affectedRows || 0) > 0;
};

const deleteAllNotifications = async (deviceDbId) => {
  await pool.execute(
    `DELETE FROM notifications
     WHERE device_id = ?`,
    [deviceDbId],
  );
};

module.exports = {
  openDevice,
  getCurrentDevice,
  syncPurchase,
  getPurchaseHistory,
  getNotifications,
  deleteNotification,
  deleteAllNotifications,
};
