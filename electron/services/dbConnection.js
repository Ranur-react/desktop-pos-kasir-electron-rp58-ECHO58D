const mysql = require("mysql2/promise");
const path = require("path");
const fs = require("fs");
const { resolveDataDir } = require("./dataPath");

let pool = null;
let currentConfig = null;

const CONFIG_FILE = "db-config.json";

function getConfigPath(app) {
  return path.join(resolveDataDir(app), CONFIG_FILE);
}

function loadConfigFromFile(app) {
  const configPath = getConfigPath(app);
  if (fs.existsSync(configPath)) {
    try {
      const data = fs.readFileSync(configPath, "utf-8");
      return JSON.parse(data);
    } catch (err) {
      console.error("Error reading DB config:", err);
      return null;
    }
  }
  return null;
}

function saveConfigToFile(app, config) {
  const configPath = getConfigPath(app);
  const dataDir = path.dirname(configPath);
  
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
}

function deleteConfigFile(app) {
  const configPath = getConfigPath(app);
  if (fs.existsSync(configPath)) {
    fs.unlinkSync(configPath);
  }
}

async function testConnection(config) {
  try {
    const connection = await mysql.createConnection({
      host: config.host,
      port: config.port || 3306,
      user: config.user,
      password: config.password || ""
    });
    
    await connection.end();
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function createTables(connection) {
  const queries = [
    `CREATE TABLE IF NOT EXISTS transactions (
      id VARCHAR(50) PRIMARY KEY,
      type ENUM('in', 'out') NOT NULL,
      nominal DECIMAL(12, 0) NOT NULL,
      description TEXT,
      created_at DATETIME NOT NULL,
      created_date DATE NOT NULL,
      INDEX idx_date (created_date)
    )`,

    `CREATE TABLE IF NOT EXISTS orders (
      id VARCHAR(50) PRIMARY KEY,
      subtotal DECIMAL(12, 0) NOT NULL,
      payment_method ENUM('cash', 'qris') NOT NULL,
      cash_given DECIMAL(12, 0),
      change_amount DECIMAL(12, 0),
      qris_meta JSON,
      status ENUM('paid', 'partial-return', 'fully-returned') DEFAULT 'paid',
      created_at DATETIME NOT NULL,
      created_date DATE NOT NULL,
      paid_at DATETIME NOT NULL,
      INDEX idx_date (created_date)
    )`,

    `CREATE TABLE IF NOT EXISTS order_items (
      line_id VARCHAR(50) PRIMARY KEY,
      order_id VARCHAR(50) NOT NULL,
      title VARCHAR(255) NOT NULL,
      price DECIMAL(12, 0) NOT NULL,
      qty INT NOT NULL,
      line_total DECIMAL(12, 0) NOT NULL,
      sku VARCHAR(100),
      variant_title VARCHAR(255),
      product_handle VARCHAR(255),
      retur_status ENUM('returned') DEFAULT NULL,
      created_at DATETIME NOT NULL,
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
      INDEX idx_order (order_id)
    )`,

    `CREATE TABLE IF NOT EXISTS order_retur_history (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      order_id VARCHAR(50) NOT NULL,
      line_id VARCHAR(50) NOT NULL,
      title VARCHAR(255) NOT NULL,
      price DECIMAL(12, 0) NOT NULL,
      qty INT NOT NULL,
      line_total DECIMAL(12, 0) NOT NULL,
      reason TEXT,
      retur_at DATETIME NOT NULL,
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
      INDEX idx_order_retur (order_id)
    )`,

    `CREATE TABLE IF NOT EXISTS catalog_products (
      id VARCHAR(255) PRIMARY KEY,
      handle VARCHAR(255) NOT NULL,
      title VARCHAR(255) NOT NULL,
      vendor VARCHAR(255),
      category VARCHAR(255),
      image_url TEXT,
      source_file VARCHAR(255),
      source_modified_at DATETIME,
      synced_at DATETIME NOT NULL,
      INDEX idx_handle (handle),
      INDEX idx_category (category)
    )`,

    `CREATE TABLE IF NOT EXISTS catalog_variants (
      id VARCHAR(255) PRIMARY KEY,
      product_id VARCHAR(255) NOT NULL,
      sku VARCHAR(255),
      title VARCHAR(255),
      price DECIMAL(12, 0) NOT NULL,
      grams DECIMAL(12, 3) DEFAULT 0,
      weight_unit VARCHAR(50),
      inventory_qty INT,
      image_url TEXT,
      source_file VARCHAR(255),
      source_modified_at DATETIME,
      synced_at DATETIME NOT NULL,
      FOREIGN KEY (product_id) REFERENCES catalog_products(id) ON DELETE CASCADE,
      INDEX idx_product_id (product_id),
      INDEX idx_sku (sku)
    )`,

    `CREATE TABLE IF NOT EXISTS accounts (
      id VARCHAR(80) PRIMARY KEY,
      username VARCHAR(120) NOT NULL UNIQUE,
      display_name VARCHAR(255),
      role VARCHAR(50) NOT NULL,
      active TINYINT(1) DEFAULT 1,
      password_cipher TEXT NOT NULL,
      created_at DATETIME NOT NULL,
      updated_at DATETIME NOT NULL,
      last_login_at DATETIME NULL,
      INDEX idx_role (role)
    )`,

    `CREATE TABLE IF NOT EXISTS store_settings (
      key_name VARCHAR(128) PRIMARY KEY,
      value TEXT,
      updated_at DATETIME NOT NULL
    )`,

    `CREATE TABLE IF NOT EXISTS manual_products (
      id VARCHAR(80) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      category VARCHAR(120),
      sku VARCHAR(120),
      unit VARCHAR(80),
      sell_price DECIMAL(12, 2) DEFAULT 0,
      cost_price DECIMAL(12, 2) DEFAULT 0,
      stock_qty DECIMAL(12, 2) DEFAULT 0,
      image_path TEXT,
      active TINYINT(1) DEFAULT 1,
      created_at DATETIME NOT NULL,
      updated_at DATETIME NOT NULL,
      INDEX idx_manual_category (category),
      INDEX idx_manual_sku (sku)
    )`,

    `CREATE TABLE IF NOT EXISTS manual_product_variants (
      id VARCHAR(80) PRIMARY KEY,
      product_id VARCHAR(80) NOT NULL,
      name VARCHAR(255) NOT NULL,
      price DECIMAL(12, 2) DEFAULT 0,
      created_at DATETIME NOT NULL,
      updated_at DATETIME NOT NULL,
      FOREIGN KEY (product_id) REFERENCES manual_products(id) ON DELETE CASCADE,
      INDEX idx_manual_product_id (product_id)
    )`
  ];

  for (const query of queries) {
    await connection.execute(query);
  }
}

async function initializeConnection(app, config) {
  try {
    if (pool && !pool._closed) {
      await closeConnection();
    }

    // Create the database if it doesn't exist
    const setupConnection = await mysql.createConnection({
      host: config.host,
      port: config.port || 3306,
      user: config.user,
      password: config.password || ""
    });

    await setupConnection.execute(
      `CREATE DATABASE IF NOT EXISTS \`${config.database}\``
    );
    await setupConnection.end();

    // Create the pool
    pool = await mysql.createPool({
      host: config.host,
      port: config.port || 3306,
      user: config.user,
      password: config.password || "",
      database: config.database,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0
    });

    // Create tables
    const connection = await pool.getConnection();
    await createTables(connection);
    connection.release();

    currentConfig = config;
    return { success: true };
  } catch (err) {
    console.error("Error initializing DB connection:", err);
    pool = null;
    currentConfig = null;
    return { success: false, error: err.message };
  }
}

async function getPool() {
  if (!pool || pool._closed) {
    pool = null;
    return null;
  }
  return pool;
}

function isConnected() {
  return Boolean(pool && !pool._closed);
}

function getConfig() {
  return currentConfig;
}

async function closeConnection() {
  if (pool) {
    await pool.end();
    pool = null;
    currentConfig = null;
  }
}

async function syncStoreSettingsToDatabase(app, settings) {
  const pool = await getPool();
  if (!pool) return { success: false, synced: 0, message: "MySQL belum terhubung." };

  const payload = settings && typeof settings === "object" ? settings : {};
  const rows = Object.entries(payload).filter(([_, value]) => value !== undefined && value !== null);
  if (!rows.length) {
    return { success: true, synced: 0, message: "Tidak ada pengaturan toko untuk disinkronkan." };
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (const [key, value] of rows) {
      await conn.execute(
        `INSERT INTO store_settings (key_name, value, updated_at)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE value = VALUES(value), updated_at = VALUES(updated_at)`,
        [key, String(value), new Date()]
      );
    }
    await conn.commit();
    return { success: true, synced: rows.length, message: "Pengaturan toko tersinkronisasi." };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function hydrateStoreSettingsFromDatabase(app) {
  const pool = await getPool();
  if (!pool) return {};

  const [rows] = await pool.execute("SELECT key_name, value FROM store_settings");
  const values = {};
  for (const row of rows) {
    values[row.key_name] = row.value;
  }

  if (!Object.keys(values).length) return {};

  const fs = require("fs");
  const path = require("path");
  const { resolveDataDir } = require("./dataPath");
  const envPath = path.join(resolveDataDir(app), ".env");
  const lines = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf-8").split(/\r?\n/) : [];
  const updated = [...lines];
  for (const [key, value] of Object.entries(values)) {
    let found = false;
    for (let i = 0; i < updated.length; i += 1) {
      const line = updated[i];
      if (!line || line.trim().startsWith("#") || !line.includes("=")) continue;
      const eq = line.indexOf("=");
      const currentKey = line.slice(0, eq).trim();
      if (currentKey === key) {
        updated[i] = `${key}=${String(value)}`;
        found = true;
        break;
      }
    }
    if (!found) {
      updated.push(`${key}=${String(value)}`);
    }
  }

  if (!fs.existsSync(envPath) || fs.readFileSync(envPath, "utf-8") !== updated.join("\n")) {
    fs.writeFileSync(envPath, updated.join("\n"), "utf-8");
  }

  return values;
}

module.exports = {
  testConnection,
  initializeConnection,
  getPool,
  isConnected,
  getConfig,
  closeConnection,
  syncStoreSettingsToDatabase,
  hydrateStoreSettingsFromDatabase,
  loadConfigFromFile,
  saveConfigToFile,
  deleteConfigFile,
  getConfigPath
};
