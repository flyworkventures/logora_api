CREATE TABLE IF NOT EXISTS devices (
  id CHAR(36) NOT NULL,
  device_id VARCHAR(191) NOT NULL,
  revenue_cat_user_id VARCHAR(191) NULL,
  token_balance INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_devices_device_id (device_id),
  KEY idx_devices_revenue_cat_user_id (revenue_cat_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS purchases (
  id CHAR(36) NOT NULL,
  device_id CHAR(36) NOT NULL,
  revenue_cat_user_id VARCHAR(191) NOT NULL,
  product_id VARCHAR(191) NOT NULL,
  transaction_id VARCHAR(191) NOT NULL,
  token_amount INT NOT NULL,
  processed TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_purchases_transaction_id (transaction_id),
  KEY idx_purchases_device_id (device_id),
  KEY idx_purchases_revenue_cat_user_id (revenue_cat_user_id),
  KEY idx_purchases_product_id (product_id),
  CONSTRAINT fk_purchases_device_id
    FOREIGN KEY (device_id) REFERENCES devices (id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS notifications (
  id CHAR(36) NOT NULL,
  device_id CHAR(36) NOT NULL,
  title VARCHAR(255) NOT NULL,
  body TEXT NOT NULL,
  is_read TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_notifications_device_id (device_id),
  KEY idx_notifications_created_at (created_at),
  CONSTRAINT fk_notifications_device_id
    FOREIGN KEY (device_id) REFERENCES devices (id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
