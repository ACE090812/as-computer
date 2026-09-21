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
