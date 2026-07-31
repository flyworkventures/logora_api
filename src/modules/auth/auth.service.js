const { randomUUID } = require('crypto');
const { pool } = require('../../db/mysql');
const { env } = require('../../config/env');
const { signDeviceToken } = require('../../utils/jwt');
const { creditPurchase } = require('../purchases/credit.service');
const { assertPurchaseSyncAllowed } = require('../purchases/revenuecat-verify');

const INITIAL_FREE_TOKEN_BALANCE = 10;

const mapDeviceRow = (row) => ({
  deviceId: row.deviceId,
  revenueCatUserId: row.revenueCatUserId,
  tokenBalance: Number(row.tokenBalance),
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

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
  await assertPurchaseSyncAllowed({
    revenueCatUserId,
    productId,
    purchaseId,
  });

  const result = await creditPurchase({
    deviceDbId,
    revenueCatUserId,
    productId,
    transactionId: purchaseId,
    source: 'client-sync',
  });

  return {
    tokenBalance: result.tokenBalance,
    tokenAmount: result.tokenAmount,
    duplicated: result.duplicated,
  };
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
