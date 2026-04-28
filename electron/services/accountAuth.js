const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { resolveDataDir } = require("./dataPath");

// AES-128-ECB key: "opener" padded to 16 bytes
const AES_KEY = Buffer.alloc(16);
AES_KEY.write("opener", 0, "utf-8");

function encryptPassword(password) {
  const cipher = crypto.createCipheriv("aes-128-ecb", AES_KEY, null);
  return Buffer.concat([cipher.update(String(password), "utf-8"), cipher.final()]).toString("hex");
}

function decryptAndVerifyPassword(password, storedHex) {
  try {
    const decipher = crypto.createDecipheriv("aes-128-ecb", AES_KEY, null);
    const plain = Buffer.concat([
      decipher.update(Buffer.from(storedHex, "hex")),
      decipher.final()
    ]).toString("utf-8");
    return plain === String(password);
  } catch {
    return false;
  }
}

const SUPPORTED_ROLES = {
  admin: {
    label: "Admin",
    permissions: {
      view_order: true,
      create_order: true,
      retur_order: true,
      view_kasir: true,
      create_transaction: true,
      print_receipt: true,
      open_drawer: true,
      view_printer: true,
      manage_printer: true,
      view_database: true,
      manage_database: true,
      manage_accounts: true
    }
  },
  cashier: {
    label: "Kasir",
    permissions: {
      view_order: true,
      create_order: true,
      retur_order: false,
      view_kasir: true,
      create_transaction: true,
      print_receipt: true,
      open_drawer: true,
      view_printer: false,
      manage_printer: false,
      view_database: false,
      manage_database: false,
      manage_accounts: false
    }
  }
};

function getAccountsFilePath(app) {
  return path.join(resolveDataDir(app), "accounts.json");
}

function readStore(app) {
  const filePath = getAccountsFilePath(app);
  if (!fs.existsSync(filePath)) {
    return { version: 1, accounts: [] };
  }

  const raw = fs.readFileSync(filePath, "utf-8");
  if (!raw) {
    return { version: 1, accounts: [] };
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.accounts)) {
      return { version: 1, accounts: [] };
    }
    return {
      version: Number(parsed.version) || 1,
      accounts: parsed.accounts
    };
  } catch {
    return { version: 1, accounts: [] };
  }
}

function writeStore(app, store) {
  const filePath = getAccountsFilePath(app);
  fs.writeFileSync(filePath, JSON.stringify(store, null, 2), "utf-8");
}

function normalizeUsername(value) {
  return String(value || "").trim().toLowerCase();
}

function validatePassword(password) {
  const text = String(password || "");
  if (text.length < 6) {
    throw new Error("Password minimal 6 karakter.");
  }
}

function validateRole(role) {
  if (!SUPPORTED_ROLES[role]) {
    throw new Error("Role tidak valid.");
  }
}

// hashPassword dan verifyPassword diganti dengan AES-128-ECB (lihat encryptPassword / decryptAndVerifyPassword di atas)

function toPublicAccount(account) {
  return {
    id: account.id,
    username: account.username,
    displayName: account.displayName,
    role: account.role,
    active: account.active !== false,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
    lastLoginAt: account.lastLoginAt || null
  };
}

function listRoleOptions() {
  return Object.entries(SUPPORTED_ROLES).map(([key, value]) => ({
    key,
    label: value.label
  }));
}

function getRolePermissions(role) {
  return { ...(SUPPORTED_ROLES[role]?.permissions || {}) };
}

function hasPermission(account, permission) {
  if (!account) return false;
  const rolePermissions = SUPPORTED_ROLES[account.role]?.permissions || {};
  return rolePermissions[permission] === true;
}

function isAuthEnabled(app) {
  const store = readStore(app);
  return store.accounts.length > 0;
}

function getAccountById(app, accountId) {
  const store = readStore(app);
  return store.accounts.find((item) => item.id === accountId) || null;
}

function getAccountByUsername(app, username) {
  const normalized = normalizeUsername(username);
  const store = readStore(app);
  return store.accounts.find((item) => item.username === normalized) || null;
}

function setupInitialAccount(app, payload) {
  const store = readStore(app);
  if (store.accounts.length > 0) {
    throw new Error("Akun sudah tersedia. Setup awal tidak dapat diulang.");
  }

  const username = normalizeUsername(payload?.username);
  const displayName = String(payload?.displayName || "").trim() || "Pemilik";
  const password = String(payload?.password || "");
  const role = payload?.role || "admin";

  if (!username) {
    throw new Error("Username wajib diisi.");
  }
  validatePassword(password);
  validateRole(role);

  const now = new Date().toISOString();

  const account = {
    id: `ACC-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    username,
    displayName,
    role,
    active: true,
    passwordCipher: encryptPassword(password),
    createdAt: now,
    updatedAt: now,
    lastLoginAt: now
  };

  store.accounts.push(account);
  writeStore(app, store);
  return account;
}

function authenticate(app, payload) {
  const username = normalizeUsername(payload?.username);
  const password = String(payload?.password || "");

  if (!username || !password) {
    throw new Error("Username dan password wajib diisi.");
  }

  const store = readStore(app);
  const account = store.accounts.find((item) => item.username === username);

  if (!account || account.active === false) {
    throw new Error("Username atau password salah.");
  }

  if (!decryptAndVerifyPassword(password, account.passwordCipher)) {
    throw new Error("Username atau password salah.");
  }

  account.lastLoginAt = new Date().toISOString();
  account.updatedAt = account.lastLoginAt;
  writeStore(app, store);

  return account;
}

function listAccounts(app) {
  const store = readStore(app);
  return store.accounts
    .map((item) => toPublicAccount(item))
    .sort((a, b) => a.username.localeCompare(b.username));
}

function createAccount(app, payload) {
  const username = normalizeUsername(payload?.username);
  const displayName = String(payload?.displayName || "").trim() || username;
  const password = String(payload?.password || "");
  const role = payload?.role || "cashier";

  if (!username) {
    throw new Error("Username wajib diisi.");
  }
  validatePassword(password);
  validateRole(role);

  const store = readStore(app);
  if (store.accounts.some((item) => item.username === username)) {
    throw new Error("Username sudah dipakai.");
  }

  const now = new Date().toISOString();

  const account = {
    id: `ACC-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    username,
    displayName,
    role,
    active: true,
    passwordCipher: encryptPassword(password),
    createdAt: now,
    updatedAt: now,
    lastLoginAt: null
  };

  store.accounts.push(account);
  writeStore(app, store);
  return toPublicAccount(account);
}

function changePassword(app, { actorAccount, targetAccountId, currentPassword, newPassword }) {
  validatePassword(newPassword);

  const store = readStore(app);
  const target = store.accounts.find((item) => item.id === targetAccountId);
  if (!target) {
    throw new Error("Akun target tidak ditemukan.");
  }

  const isSelf = actorAccount?.id === target.id;
  const actorIsAdmin = actorAccount?.role === "admin";

  if (!isSelf && !actorIsAdmin) {
    throw new Error("Hanya admin yang boleh mengubah password akun lain.");
  }

  if (isSelf && !actorIsAdmin) {
    if (!decryptAndVerifyPassword(String(currentPassword || ""), target.passwordCipher)) {
      throw new Error("Password saat ini tidak sesuai.");
    }
  }

  target.passwordCipher = encryptPassword(newPassword);
  target.updatedAt = new Date().toISOString();

  writeStore(app, store);
  return toPublicAccount(target);
}

function changeRole(app, { targetAccountId, role }) {
  validateRole(role);

  const store = readStore(app);
  const target = store.accounts.find((item) => item.id === targetAccountId);
  if (!target) {
    throw new Error("Akun target tidak ditemukan.");
  }

  if (target.role === "admin" && role !== "admin") {
    const activeAdmins = store.accounts.filter((item) => item.role === "admin" && item.active !== false);
    if (activeAdmins.length <= 1) {
      throw new Error("Minimal harus ada 1 akun admin aktif.");
    }
  }

  target.role = role;
  target.updatedAt = new Date().toISOString();
  writeStore(app, store);

  return toPublicAccount(target);
}

function buildAuthState(app, sessionAccount) {
  const enabled = isAuthEnabled(app);
  const user = sessionAccount ? toPublicAccount(sessionAccount) : null;

  return {
    enabled,
    needsSetup: !enabled,
    user,
    permissions: sessionAccount ? getRolePermissions(sessionAccount.role) : {},
    roles: listRoleOptions()
  };
}

module.exports = {
  authenticate,
  buildAuthState,
  changePassword,
  changeRole,
  createAccount,
  getAccountById,
  getAccountByUsername,
  getRolePermissions,
  hasPermission,
  isAuthEnabled,
  listAccounts,
  listRoleOptions,
  setupInitialAccount
};
