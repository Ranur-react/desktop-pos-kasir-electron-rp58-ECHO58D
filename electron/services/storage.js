const fs = require("fs");
const path = require("path");
const { resolveDataDir } = require("./dataPath");

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

function getTodayTransactions(app) {
  return readTransactions(app).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function addTransaction(app, input) {
  const transactions = readTransactions(app);
  const now = new Date();

  const tx = {
    id: `TX-${now.getTime()}`,
    type: input.type,
    nominal: Number(input.nominal),
    description: input.description || "",
    createdAt: now.toISOString()
  };

  transactions.push(tx);
  writeTransactions(app, transactions);
  return tx;
}

function getTodaySummary(app) {
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

function getLatestTransaction(app) {
  const transactions = readTransactions(app);
  if (transactions.length === 0) {
    return null;
  }

  return transactions.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

module.exports = {
  getTodayTransactions,
  addTransaction,
  getTodaySummary,
  getLatestTransaction
};
