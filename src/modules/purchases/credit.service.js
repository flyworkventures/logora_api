const { randomUUID } = require('crypto');
const { pool } = require('../../db/mysql');
const { resolveTokenAmount } = require('./token-map');

const createNotification = async ({ connection, deviceId, title, body }) => {
  await connection.execute(
    `INSERT INTO notifications (id, device_id, title, body, is_read)
     VALUES (?, ?, ?, ?, 0)`,
    [randomUUID(), deviceId, title, body],
  );
};

/**
 * Atomik token kredisi. Aynı transaction_id tekrar gelirse duplicated döner.
 * deviceDbId verilirse o cihaz kilitlenir; yoksa revenueCatUserId ile bulunur.
 */
const creditPurchase = async ({
  deviceDbId = null,
  revenueCatUserId,
  productId,
  transactionId,
  source = 'sync',
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

    const [existingPurchaseRows] = await connection.execute(
      `SELECT id
       FROM purchases
       WHERE transaction_id = ?
       LIMIT 1`,
      [transactionId],
    );
    if ((existingPurchaseRows || []).length > 0) {
      let tokenBalance = 0;
      if (deviceDbId) {
        const [rows] = await connection.execute(
          `SELECT token_balance AS tokenBalance FROM devices WHERE id = ? LIMIT 1`,
          [deviceDbId],
        );
        tokenBalance = Number((rows || [])[0]?.tokenBalance || 0);
      } else {
        const [rows] = await connection.execute(
          `SELECT token_balance AS tokenBalance
           FROM devices
           WHERE revenue_cat_user_id = ?
           LIMIT 1`,
          [revenueCatUserId],
        );
        tokenBalance = Number((rows || [])[0]?.tokenBalance || 0);
      }
      await connection.commit();
      return {
        tokenBalance,
        tokenAmount: 0,
        duplicated: true,
        processed: false,
        reason: 'Duplicate transaction',
      };
    }

    let device;
    if (deviceDbId) {
      const [deviceRows] = await connection.execute(
        `SELECT id, device_id AS deviceId, revenue_cat_user_id AS revenueCatUserId, token_balance AS tokenBalance
         FROM devices
         WHERE id = ?
         LIMIT 1
         FOR UPDATE`,
        [deviceDbId],
      );
      device = (deviceRows || [])[0];
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
    } else {
      const [deviceRows] = await connection.execute(
        `SELECT id, device_id AS deviceId, revenue_cat_user_id AS revenueCatUserId, token_balance AS tokenBalance
         FROM devices
         WHERE revenue_cat_user_id = ?
         LIMIT 1
         FOR UPDATE`,
        [revenueCatUserId],
      );
      device = (deviceRows || [])[0];
      if (!device) {
        const error = new Error(
          `Device not found for revenueCatUserId: ${revenueCatUserId}`,
        );
        error.statusCode = 404;
        throw error;
      }
    }

    await connection.execute(
      `INSERT INTO purchases (id, device_id, revenue_cat_user_id, product_id, transaction_id, token_amount, processed)
       VALUES (?, ?, ?, ?, ?, ?, 1)`,
      [
        randomUUID(),
        device.id,
        revenueCatUserId,
        productId,
        transactionId,
        tokenAmount,
      ],
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
      processed: true,
      productId,
      transactionId,
      source,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

module.exports = { creditPurchase };
