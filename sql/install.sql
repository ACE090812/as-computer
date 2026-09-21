CREATE TABLE IF NOT EXISTS `mot_history` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `plate` VARCHAR(15) NOT NULL,
  `vin` VARCHAR(32) DEFAULT NULL,
  `passed` TINYINT(1) NOT NULL DEFAULT 0,
  `failed_items` JSON DEFAULT NULL,     -- array of checklist item ids
  `advisory_items` JSON DEFAULT NULL,   -- array of checklist item ids
  `mileage` INT UNSIGNED DEFAULT NULL,
  `mileage_unit` VARCHAR(12) DEFAULT NULL, -- "miles" | "kilometers", from jg-vehiclemileage if installed
  `tester_identifier` VARCHAR(64) DEFAULT NULL,
  `tester_name` VARCHAR(64) DEFAULT NULL,
  `location_label` VARCHAR(64) DEFAULT NULL,
  `test_number` VARCHAR(20) DEFAULT NULL,
  `issued_at` DATETIME NOT NULL,
  `expires_at` DATETIME DEFAULT NULL,   -- NULL when passed = 0 (a fail has no expiry, just a re-test)
  PRIMARY KEY (`id`),
  INDEX `idx_plate` (`plate`),
  INDEX `idx_expires` (`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Store installs (created automatically on start too). One row per job and app.
CREATE TABLE IF NOT EXISTS `computer_apps` (
  `job` VARCHAR(50) NOT NULL,
  `app` VARCHAR(50) NOT NULL,
  `installed` TINYINT(1) NOT NULL DEFAULT 1,
  `paid` TINYINT(1) NOT NULL DEFAULT 0,        -- a job that has paid once can reinstall for free
  `installed_by` VARCHAR(64) DEFAULT NULL,
  `installed_name` VARCHAR(64) DEFAULT NULL,
  `installed_at` DATETIME DEFAULT NULL,
  PRIMARY KEY (`job`, `app`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Per-character Settings (created automatically on start too). Only values the player changed are stored.
CREATE TABLE IF NOT EXISTS `computer_settings` (
  `citizenid` VARCHAR(64) NOT NULL,
  `data` LONGTEXT NOT NULL,
  PRIMARY KEY (`citizenid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- MOT bookings made on the government website (created automatically on start too).
CREATE TABLE IF NOT EXISTS `computer_bookings` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `garage` VARCHAR(50) NOT NULL,
  `job` VARCHAR(50) NOT NULL,
  `cid` VARCHAR(64) NOT NULL,
  `name` VARCHAR(80) DEFAULT NULL,
  `plate` VARCHAR(16) NOT NULL,
  `vehicle` VARCHAR(80) DEFAULT NULL,
  `slot_ts` INT NOT NULL,
  `date` CHAR(10) NOT NULL,
  `time` CHAR(5) NOT NULL,
  `duration` INT NOT NULL DEFAULT 30,
  `fee` INT NOT NULL DEFAULT 0,
  `status` VARCHAR(12) NOT NULL DEFAULT 'held',   -- held | booked | done | missed | cancelled | moved
  `reminded` TINYINT(1) NOT NULL DEFAULT 0,
  `settled` TINYINT(1) NOT NULL DEFAULT 0,        -- fee paid into the society account
  `created_at` INT NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_slot` (`garage`, `slot_ts`),
  KEY `idx_cid` (`cid`),
  KEY `idx_job_date` (`job`, `date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- ---------------------------------------------------------------------------------------------
-- Mechanic app (created automatically on start; run this only if you prefer to do it by hand)
-- ---------------------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS `computer_mech_customers` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `job` VARCHAR(50) NOT NULL,
  `name` VARCHAR(80) NOT NULL,
  `phone` VARCHAR(30) DEFAULT NULL,
  `email` VARCHAR(120) DEFAULT NULL,
  `cid` VARCHAR(64) DEFAULT NULL,
  `notes` VARCHAR(300) DEFAULT NULL,
  `created_at` INT NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_job` (`job`),
  KEY `idx_cid` (`job`, `cid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `computer_mech_jobs` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `job` VARCHAR(50) NOT NULL,
  `num` INT NOT NULL,
  `customer_id` INT DEFAULT NULL,
  `plate` VARCHAR(16) NOT NULL,
  `vehicle` VARCHAR(80) DEFAULT NULL,
  `mileage` INT DEFAULT NULL,
  `title` VARCHAR(100) NOT NULL,
  `description` VARCHAR(600) DEFAULT NULL,
  `status` VARCHAR(16) NOT NULL DEFAULT 'open',
  `assigned_cid` VARCHAR(64) DEFAULT NULL,
  `assigned_name` VARCHAR(80) DEFAULT NULL,
  `tasks` TEXT DEFAULT NULL,
  `created_by` VARCHAR(64) DEFAULT NULL,
  `created_name` VARCHAR(80) DEFAULT NULL,
  `created_at` INT NOT NULL,
  `updated_at` INT NOT NULL,
  `completed_at` INT DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_job_num` (`job`, `num`),
  KEY `idx_plate` (`plate`),
  KEY `idx_status` (`job`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `computer_mech_docs` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `job` VARCHAR(50) NOT NULL,
  `kind` VARCHAR(8) NOT NULL,
  `num` INT NOT NULL,
  `customer_id` INT DEFAULT NULL,
  `job_card_id` INT DEFAULT NULL,
  `converted_from` INT DEFAULT NULL,
  `plate` VARCHAR(16) DEFAULT NULL,
  `vehicle` VARCHAR(80) DEFAULT NULL,
  `status` VARCHAR(10) NOT NULL DEFAULT 'draft',
  `notes` VARCHAR(600) DEFAULT NULL,
  `vat_rate` INT NOT NULL DEFAULT 0,
  `subtotal` INT NOT NULL DEFAULT 0,
  `vat` INT NOT NULL DEFAULT 0,
  `total` INT NOT NULL DEFAULT 0,
  `created_by` VARCHAR(64) DEFAULT NULL,
  `created_name` VARCHAR(80) DEFAULT NULL,
  `created_at` INT NOT NULL,
  `updated_at` INT NOT NULL,
  `issued_at` INT DEFAULT NULL,
  `due_at` INT DEFAULT NULL,
  `paid_at` INT DEFAULT NULL,
  `paid_method` VARCHAR(10) DEFAULT NULL,
  `paid_by` VARCHAR(80) DEFAULT NULL,
  `stock_applied` TINYINT(1) NOT NULL DEFAULT 0,
  `settled` TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_doc_num` (`job`, `kind`, `num`),
  KEY `idx_plate` (`plate`),
  KEY `idx_customer` (`customer_id`),
  KEY `idx_jobcard` (`job_card_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `computer_mech_lines` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `doc_id` INT NOT NULL,
  `sort` INT NOT NULL DEFAULT 0,
  `kind` VARCHAR(8) NOT NULL DEFAULT 'other',
  `description` VARCHAR(120) NOT NULL,
  `qty` DECIMAL(8,2) NOT NULL DEFAULT 1,
  `unit_price` INT NOT NULL DEFAULT 0,
  `part_id` INT DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_doc` (`doc_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `computer_mech_parts` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `job` VARCHAR(50) NOT NULL,
  `sku` VARCHAR(30) DEFAULT NULL,
  `name` VARCHAR(80) NOT NULL,
  `category` VARCHAR(30) DEFAULT NULL,
  `qty` INT NOT NULL DEFAULT 0,
  `min_qty` INT NOT NULL DEFAULT 0,
  `cost` INT NOT NULL DEFAULT 0,
  `price` INT NOT NULL DEFAULT 0,
  `supplier` VARCHAR(60) DEFAULT NULL,
  `active` TINYINT(1) NOT NULL DEFAULT 1,
  `updated_at` INT NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_job` (`job`, `active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `computer_mech_stock_log` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `job` VARCHAR(50) NOT NULL,
  `part_id` INT NOT NULL,
  `delta` INT NOT NULL,
  `reason` VARCHAR(80) DEFAULT NULL,
  `by_name` VARCHAR(80) DEFAULT NULL,
  `at` INT NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_part` (`part_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
