const fs = require("fs");
const path = require("path");
const { resolveDataDir } = require("./dataPath");
const db = require("./dbConnection");

function getDateKey() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function getTodayFilePath(app) {
  return path.join(resolveDataDir(app), `transactions-${getDateKey()}.json`);
}

function readTransactions(app) {
  const filePath = getTodayFilePath(app);
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const raw = fs.readFileSync(filePath, "utf-8");
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeTransactions(app, transactions) {
  const filePath = getTodayFilePath(app);
  fs.writeFileSync(filePath, JSON.stringify(transactions, null, 2), "utf-8");
}

// Database functions
async function readTransactionsFromDB() {
  try {
    const pool = await db.getPool();
    if (!pool) return [];

    const today = getDateKey();
    const [rows] = await pool.execute(
      `SELECT * FROM transactions 
       WHERE created_date = ? 
       ORDER BY created_at DESC`,
      [today]
    );

    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      nominal: Number(row.nominal),
      description: row.description || "",
      createdAt: row.created_at.toISOString()
    }));
  } catch (err) {
    console.error("Error reading transactions from DB:", err);
    return [];
  }
}

async function writeTransactionsToDB(transaction) {
  try {
    const pool = await db.getPool();
    if (!pool) return null;

    const createdAt = new Date(transaction.createdAt);
    const createdDate = createdAt.toISOString().split("T")[0];

    await pool.execute(
      `INSERT INTO transactions (id, type, nominal, description, created_at, created_date) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        transaction.id,
        transaction.type,
        transaction.nominal,
        transaction.description,
        createdAt,
        createdDate
      ]
    );

    return transaction;
  } catch (err) {
    console.error("Error writing transaction to DB:", err);
    return null;
  }
}

// Public functions
async function getTodayTransactions(app) {
  if (db.isConnected()) {
    return await readTransactionsFromDB();
  }
  return readTransactions(app).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function addTransaction(app, input) {
  const now = new Date();

  const tx = {
    id: `TX-${now.getTime()}`,
    type: input.type,
    nominal: Number(input.nominal),
    description: input.description || "",
    createdAt: now.toISOString()
  };

  if (db.isConnected()) {
    // Write to DB asynchronously without blocking
    writeTransactionsToDB(tx).catch((err) => {
      console.error("Async DB write failed:", err);
    });
  } else {
    // Write to JSON
    const transactions = readTransactions(app);
    transactions.push(tx);
    writeTransactions(app, transactions);
  }

  return tx;
}

async function getTodaySummary(app) {
  if (db.isConnected()) {
    return await getTodaySummaryFromDB();
  }

  const transactions = readTransactions(app);

  const totalIn = transactions
    .filter((tx) => tx.type === "in")
    .reduce((sum, tx) => sum + Number(tx.nominal || 0), 0);

  const totalOut = transactions
    .filter((tx) => tx.type === "out")
    .reduce((sum, tx) => sum + Number(tx.nominal || 0), 0);

  return {
    totalIn,
    totalOut,
    balance: totalIn - totalOut
  };
}

async function getTodaySummaryFromDB() {
  try {
    const pool = await db.getPool();
    if (!pool) return { totalIn: 0, totalOut: 0, balance: 0 };

    const today = getDateKey();

    const [inRows] = await pool.execute(
      `SELECT COALESCE(SUM(nominal), 0) as total FROM transactions 
       WHERE created_date = ? AND type = 'in'`,
      [today]
    );

    const [outRows] = await pool.execute(
      `SELECT COALESCE(SUM(nominal), 0) as total FROM transactions 
       WHERE created_date = ? AND type = 'out'`,
      [today]
    );

    const totalIn = Number(inRows[0].total || 0);
    const totalOut = Number(outRows[0].total || 0);

    return {
      totalIn,
      totalOut,
      balance: totalIn - totalOut
    };
  } catch (err) {
    console.error("Error getting summary from DB:", err);
    return { totalIn: 0, totalOut: 0, balance: 0 };
  }
}

async function getLatestTransaction(app) {
  if (db.isConnected()) {
    return await getLatestTransactionFromDB();
  }

  const transactions = readTransactions(app);
  if (transactions.length === 0) {
    return null;
  }

  return transactions.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

async function getLatestTransactionFromDB() {
  try {
    const pool = await db.getPool();
    if (!pool) return null;

    const [rows] = await pool.execute(
      `SELECT * FROM transactions 
       ORDER BY created_at DESC 
       LIMIT 1`
    );

    if (rows.length === 0) return null;

    const row = rows[0];
    return {
      id: row.id,
      type: row.type,
      nominal: Number(row.nominal),
      description: row.description || "",
      createdAt: row.created_at.toISOString()
    };
  } catch (err) {
    console.error("Error getting latest transaction from DB:", err);
    return null;
  }
}

module.exports = {
  getTodayTransactions,
  addTransaction,
  getTodaySummary,
  getLatestTransaction,
  readTransactionsFromDB,
  getTodaySummaryFromDB,
  getLatestTransactionFromDB
};
