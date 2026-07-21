const { Router } = require('express');
const { randomUUID } = require('crypto');
const { pool } = require('../db/mysql');
const panelAuth = require('../middleware/panelAuth');

const router = Router();
router.use(panelAuth);

function positiveInt(value, fallback, max = 100) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

function likeTerm(value) {
  return `%${String(value || '').trim()}%`;
}

function pagination(page, limit, total) {
  return {
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  };
}

function mapDevice(row) {
  return {
    id: row.id,
    deviceId: row.device_id,
    revenueCatUserId: row.revenue_cat_user_id,
    tokenBalance: Number(row.token_balance || 0),
    purchaseCount: Number(row.purchase_count || 0),
    notificationCount: Number(row.notification_count || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPurchase(row) {
  return {
    id: row.id,
    deviceDbId: row.device_id,
    deviceId: row.device_external_id || null,
    revenueCatUserId: row.revenue_cat_user_id,
    productId: row.product_id,
    transactionId: row.transaction_id,
    tokenAmount: Number(row.token_amount || 0),
    processed: row.processed === 1 || row.processed === true,
    createdAt: row.created_at,
  };
}

function mapNotification(row) {
  return {
    id: row.id,
    deviceDbId: row.device_id,
    deviceId: row.device_external_id || null,
    title: row.title,
    body: row.body,
    isRead: row.is_read === 1 || row.is_read === true,
    createdAt: row.created_at,
  };
}

router.get('/health', (_req, res) => {
  return res.json({ ok: true, service: 'logora-panel', timestamp: new Date().toISOString() });
});

router.get('/options', async (_req, res) => {
  try {
    const [productRows] = await pool.query(
      `SELECT DISTINCT product_id AS productId
       FROM purchases
       WHERE product_id IS NOT NULL AND product_id <> ''
       ORDER BY product_id ASC
       LIMIT 200`,
    );
    return res.json({
      ok: true,
      data: {
        products: productRows.map((row) => row.productId).filter(Boolean),
      },
    });
  } catch (error) {
    console.error('Logora panel options error:', error);
    return res.status(500).json({ ok: false, error: 'Options alınamadı.' });
  }
});

router.get('/analyse', async (_req, res) => {
  try {
    const [[totals]] = await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM devices) AS totalDevices,
         (SELECT COALESCE(SUM(token_balance), 0) FROM devices) AS totalTokens,
         (SELECT COUNT(*) FROM devices WHERE token_balance > 0) AS devicesWithTokens,
         (SELECT COUNT(*) FROM purchases) AS totalPurchases,
         (SELECT COALESCE(SUM(token_amount), 0) FROM purchases WHERE processed = 1) AS tokensSold,
         (SELECT COUNT(*) FROM notifications) AS totalNotifications,
         (SELECT COUNT(*) FROM devices WHERE DATE(created_at) = CURDATE()) AS newDevicesToday,
         (SELECT COUNT(*) FROM purchases WHERE DATE(created_at) = CURDATE()) AS purchasesToday`,
    );

    const [daily] = await pool.query(
      `SELECT d.day AS date,
              COALESCE(dev.cnt, 0) AS newUsers,
              COALESCE(pur.cnt, 0) AS purchases
       FROM (
         SELECT CURDATE() - INTERVAL seq DAY AS day
         FROM (
           SELECT 0 AS seq UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3
           UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7
           UNION ALL SELECT 8 UNION ALL SELECT 9 UNION ALL SELECT 10 UNION ALL SELECT 11
           UNION ALL SELECT 12 UNION ALL SELECT 13
         ) AS seqs
       ) AS d
       LEFT JOIN (
         SELECT DATE(created_at) AS day, COUNT(*) AS cnt
         FROM devices
         WHERE created_at >= CURDATE() - INTERVAL 13 DAY
         GROUP BY DATE(created_at)
       ) AS dev ON dev.day = d.day
       LEFT JOIN (
         SELECT DATE(created_at) AS day, COUNT(*) AS cnt
         FROM purchases
         WHERE created_at >= CURDATE() - INTERVAL 13 DAY
         GROUP BY DATE(created_at)
       ) AS pur ON pur.day = d.day
       ORDER BY d.day ASC`,
    );

    const [topProducts] = await pool.query(
      `SELECT product_id AS label, COUNT(*) AS count
       FROM purchases
       GROUP BY product_id
       ORDER BY count DESC
       LIMIT 8`,
    );

    const [tokenBuckets] = await pool.query(
      `SELECT
         CASE
           WHEN token_balance = 0 THEN '0 token'
           WHEN token_balance BETWEEN 1 AND 10 THEN '1-10'
           WHEN token_balance BETWEEN 11 AND 50 THEN '11-50'
           WHEN token_balance BETWEEN 51 AND 100 THEN '51-100'
           ELSE '100+'
         END AS label,
         COUNT(*) AS count
       FROM devices
       GROUP BY label
       ORDER BY MIN(token_balance)`,
    );

    return res.json({
      ok: true,
      summary: {
        totalUsers: Number(totals.totalDevices || 0),
        totalDevices: Number(totals.totalDevices || 0),
        totalTokens: Number(totals.totalTokens || 0),
        devicesWithTokens: Number(totals.devicesWithTokens || 0),
        totalPurchases: Number(totals.totalPurchases || 0),
        tokensSold: Number(totals.tokensSold || 0),
        totalNotifications: Number(totals.totalNotifications || 0),
        newUsersToday: Number(totals.newDevicesToday || 0),
        purchasesToday: Number(totals.purchasesToday || 0),
      },
      daily: daily.map((row) => ({
        date: row.date,
        newUsers: Number(row.newUsers || 0),
        purchases: Number(row.purchases || 0),
      })),
      insights: {
        topProducts: topProducts.map((row) => ({
          label: row.label || '—',
          count: Number(row.count || 0),
        })),
        tokenBuckets: tokenBuckets.map((row) => ({
          label: row.label,
          count: Number(row.count || 0),
        })),
      },
    });
  } catch (error) {
    console.error('Logora panel analyse error:', error);
    return res.status(500).json({ ok: false, error: 'Analiz verisi alınamadı.' });
  }
});

router.get('/users', async (req, res) => {
  try {
    const page = positiveInt(req.query.page, 1, 10000);
    const limit = positiveInt(req.query.limit, 20, 100);
    const offset = (page - 1) * limit;
    const search = String(req.query.search || '').trim();
    const hasTokens = String(req.query.hasTokens || '').trim();

    const where = [];
    const params = [];

    if (search) {
      where.push('(d.device_id LIKE ? OR d.revenue_cat_user_id LIKE ? OR d.id LIKE ?)');
      const term = likeTerm(search);
      params.push(term, term, term);
    }
    if (hasTokens === '1') {
      where.push('d.token_balance > 0');
    } else if (hasTokens === '0') {
      where.push('d.token_balance = 0');
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [[countRow]] = await pool.query(
      `SELECT COUNT(*) AS total FROM devices d ${whereSql}`,
      params,
    );
    const [rows] = await pool.query(
      `SELECT d.*,
              (SELECT COUNT(*) FROM purchases p WHERE p.device_id = d.id) AS purchase_count,
              (SELECT COUNT(*) FROM notifications n WHERE n.device_id = d.id) AS notification_count
       FROM devices d
       ${whereSql}
       ORDER BY d.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );

    return res.json({
      ok: true,
      data: rows.map(mapDevice),
      pagination: pagination(page, limit, Number(countRow.total || 0)),
    });
  } catch (error) {
    console.error('Logora panel users error:', error);
    return res.status(500).json({ ok: false, error: 'Kullanıcılar alınamadı.' });
  }
});

router.patch('/users/:userId', async (req, res) => {
  try {
    const userId = String(req.params.userId || '').trim();
    if (!userId) {
      return res.status(400).json({ ok: false, error: 'Geçersiz kullanıcı id.' });
    }

    const [existingRows] = await pool.query(
      `SELECT * FROM devices WHERE id = ? OR device_id = ? LIMIT 1`,
      [userId, userId],
    );
    if (!existingRows.length) {
      return res.status(404).json({ ok: false, error: 'Cihaz bulunamadı.' });
    }

    const device = existingRows[0];
    const updates = [];
    const params = [];

    if (req.body.tokenBalance != null || req.body.token_balance != null) {
      const balance = Number(req.body.tokenBalance ?? req.body.token_balance);
      if (!Number.isFinite(balance) || balance < 0) {
        return res.status(400).json({ ok: false, error: 'Geçersiz token bakiyesi.' });
      }
      updates.push('token_balance = ?');
      params.push(Math.floor(balance));
    }

    if (req.body.revenueCatUserId !== undefined || req.body.revenue_cat_user_id !== undefined) {
      const rcId = String(req.body.revenueCatUserId ?? req.body.revenue_cat_user_id ?? '').trim();
      updates.push('revenue_cat_user_id = ?');
      params.push(rcId || null);
    }

    if (!updates.length) {
      return res.status(400).json({ ok: false, error: 'Güncellenecek alan yok.' });
    }

    params.push(device.id);
    await pool.query(`UPDATE devices SET ${updates.join(', ')} WHERE id = ?`, params);

    const [rows] = await pool.query(
      `SELECT d.*,
              (SELECT COUNT(*) FROM purchases p WHERE p.device_id = d.id) AS purchase_count,
              (SELECT COUNT(*) FROM notifications n WHERE n.device_id = d.id) AS notification_count
       FROM devices d
       WHERE d.id = ?
       LIMIT 1`,
      [device.id],
    );

    return res.json({ ok: true, data: mapDevice(rows[0]) });
  } catch (error) {
    console.error('Logora panel user patch error:', error);
    return res.status(500).json({ ok: false, error: 'Kullanıcı güncellenemedi.' });
  }
});

router.post('/users', async (req, res) => {
  try {
    const deviceId = String(req.body.deviceId || req.body.device_id || '').trim();
    if (!deviceId) {
      return res.status(400).json({ ok: false, error: 'deviceId zorunlu.' });
    }

    const tokenBalance = Number(req.body.tokenBalance ?? req.body.token_balance ?? 10);
    if (!Number.isFinite(tokenBalance) || tokenBalance < 0) {
      return res.status(400).json({ ok: false, error: 'Geçersiz token bakiyesi.' });
    }

    const revenueCatUserId = String(
      req.body.revenueCatUserId || req.body.revenue_cat_user_id || '',
    ).trim() || null;

    const [existing] = await pool.query(
      `SELECT id FROM devices WHERE device_id = ? LIMIT 1`,
      [deviceId],
    );
    if (existing.length) {
      return res.status(409).json({ ok: false, error: 'Bu deviceId zaten kayıtlı.' });
    }

    const id = randomUUID();
    await pool.query(
      `INSERT INTO devices (id, device_id, revenue_cat_user_id, token_balance)
       VALUES (?, ?, ?, ?)`,
      [id, deviceId, revenueCatUserId, Math.floor(tokenBalance)],
    );

    const [rows] = await pool.query(
      `SELECT d.*, 0 AS purchase_count, 0 AS notification_count
       FROM devices d WHERE d.id = ? LIMIT 1`,
      [id],
    );

    return res.status(201).json({ ok: true, data: mapDevice(rows[0]) });
  } catch (error) {
    console.error('Logora panel user create error:', error);
    return res.status(500).json({ ok: false, error: 'Cihaz oluşturulamadı.' });
  }
});

router.get('/purchases', async (req, res) => {
  try {
    const page = positiveInt(req.query.page, 1, 10000);
    const limit = positiveInt(req.query.limit, 20, 100);
    const offset = (page - 1) * limit;
    const search = String(req.query.search || '').trim();
    const productId = String(req.query.productId || req.query.product_id || '').trim();
    const processed = String(req.query.processed || '').trim();
    const deviceId = String(req.query.deviceId || req.query.userId || '').trim();

    const where = [];
    const params = [];

    if (search) {
      where.push(
        '(p.product_id LIKE ? OR p.transaction_id LIKE ? OR p.revenue_cat_user_id LIKE ? OR d.device_id LIKE ?)',
      );
      const term = likeTerm(search);
      params.push(term, term, term, term);
    }
    if (productId) {
      where.push('p.product_id = ?');
      params.push(productId);
    }
    if (processed === '1' || processed === '0') {
      where.push('p.processed = ?');
      params.push(Number(processed));
    }
    if (deviceId) {
      where.push('(p.device_id = ? OR d.device_id = ?)');
      params.push(deviceId, deviceId);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [[countRow]] = await pool.query(
      `SELECT COUNT(*) AS total
       FROM purchases p
       LEFT JOIN devices d ON d.id = p.device_id
       ${whereSql}`,
      params,
    );
    const [rows] = await pool.query(
      `SELECT p.*, d.device_id AS device_external_id
       FROM purchases p
       LEFT JOIN devices d ON d.id = p.device_id
       ${whereSql}
       ORDER BY p.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );

    return res.json({
      ok: true,
      data: rows.map(mapPurchase),
      pagination: pagination(page, limit, Number(countRow.total || 0)),
    });
  } catch (error) {
    console.error('Logora panel purchases error:', error);
    return res.status(500).json({ ok: false, error: 'Satın alımlar alınamadı.' });
  }
});

router.get('/notifications', async (req, res) => {
  try {
    const page = positiveInt(req.query.page, 1, 10000);
    const limit = positiveInt(req.query.limit, 20, 100);
    const offset = (page - 1) * limit;
    const search = String(req.query.search || '').trim();
    const isRead = String(req.query.isRead || req.query.is_read || '').trim();

    const where = [];
    const params = [];

    if (search) {
      where.push('(n.title LIKE ? OR n.body LIKE ? OR d.device_id LIKE ?)');
      const term = likeTerm(search);
      params.push(term, term, term);
    }
    if (isRead === '1' || isRead === '0') {
      where.push('n.is_read = ?');
      params.push(Number(isRead));
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [[countRow]] = await pool.query(
      `SELECT COUNT(*) AS total
       FROM notifications n
       LEFT JOIN devices d ON d.id = n.device_id
       ${whereSql}`,
      params,
    );
    const [rows] = await pool.query(
      `SELECT n.*, d.device_id AS device_external_id
       FROM notifications n
       LEFT JOIN devices d ON d.id = n.device_id
       ${whereSql}
       ORDER BY n.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );

    return res.json({
      ok: true,
      data: rows.map(mapNotification),
      pagination: pagination(page, limit, Number(countRow.total || 0)),
    });
  } catch (error) {
    console.error('Logora panel notifications error:', error);
    return res.status(500).json({ ok: false, error: 'Bildirimler alınamadı.' });
  }
});

module.exports = router;
