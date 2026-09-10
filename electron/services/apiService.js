const fs = require("fs");
const path = require("path");
const { resolveDataDir } = require("./dataPath");

const CONFIG_FILE = "server-config.json";
const CACHE_FILE = "api-products-cache.json";

function getConfigPath(app) {
  return path.join(resolveDataDir(app), CONFIG_FILE);
}

function getCachePath(app) {
  return path.join(resolveDataDir(app), CACHE_FILE);
}

function getDefaultServerUrl() {
  try {
    const pkg = require("../../package.json");
    return process.env.API_SERVER_URL || pkg.api_base_url || pkg.apiBaseUrl || "https://atikahjaya.com";
  } catch {
    return process.env.API_SERVER_URL || "https://atikahjaya.com";
  }
}

function getServerConfig(app) {
  const configPath = getConfigPath(app);
  const defaultUrl = getDefaultServerUrl();
  const defaults = {
    serverUrl: defaultUrl,
    token: null,
    user: null,
    branch: null,
    autoSync: true
  };

  if (!fs.existsSync(configPath)) {
    return defaults;
  }

  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw);
    const result = { ...defaults, ...parsed };
    if (!result.serverUrl || result.serverUrl === "http://localhost/pos") {
      result.serverUrl = defaultUrl;
    }
    return result;
  } catch {
    return defaults;
  }
}

function saveServerConfig(app, newConfig) {
  const current = getServerConfig(app);
  const updated = { ...current, ...newConfig };
  if (updated.serverUrl) {
    updated.serverUrl = updated.serverUrl.replace(/\/+$/, "");
  }
  fs.writeFileSync(getConfigPath(app), JSON.stringify(updated, null, 2), "utf-8");
  return updated;
}

async function requestApi(url, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
    ...(options.headers || {})
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeout || 10000);

  try {
    const res = await fetch(url, {
      ...options,
      headers,
      signal: controller.signal
    });

    clearTimeout(timeoutId);
    const data = await res.json().catch(() => null);

    if (!res.ok) {
      const msg = (data && data.message) || `HTTP ${res.status}: ${res.statusText}`;
      const err = new Error(msg);
      err.status = res.status;
      err.data = data;
      throw err;
    }

    return data;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === "AbortError") {
      throw new Error("Koneksi ke server timeout (lebih dari 10 detik).");
    }
    throw err;
  }
}

async function testConnection(serverUrl) {
  const cleanUrl = (serverUrl || "").replace(/\/+$/, "");
  try {
    // We ping the bootstrap or options endpoint
    const res = await requestApi(`${cleanUrl}/api/desktop/bootstrap`, {
      method: "GET",
      timeout: 5000
    }).catch((err) => {
      // 401 is expected if token is not sent, which confirms server is reachable!
      if (err.status === 401) {
        return { reachable: true, requiresAuth: true };
      }
      throw err;
    });

    return { success: true, message: "Koneksi ke Server Web Hosting berhasil!" };
  } catch (err) {
    return { success: false, error: err.message || "Tidak dapat menghubungi server web." };
  }
}

async function login(app, username, password) {
  const config = getServerConfig(app);
  const url = `${config.serverUrl}/api/desktop/login`;

  const data = await requestApi(url, {
    method: "POST",
    body: JSON.stringify({ username, password }),
    timeout: 3500
  });

  if (data && data.status === "success" && data.token) {
    saveServerConfig(app, {
      token: data.token,
      user: data.user,
      branch: {
        id: data.user?.cabang_id || 0,
        name: data.user?.cabang_nama || "Cabang Utama"
      }
    });
    return data;
  }

  throw new Error(data?.message || "Login gagal.");
}

async function getBootstrap(app) {
  const config = getServerConfig(app);
  if (!config.token) return null;

  const url = `${config.serverUrl}/api/desktop/bootstrap`;
  return await requestApi(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${config.token}` }
  });
}

async function getProducts(app, params = {}) {
  const config = getServerConfig(app);
  const searchParams = new URLSearchParams();
  if (params.search) searchParams.append("search", params.search);
  if (params.kategori_id) searchParams.append("kategori_id", params.kategori_id);

  const query = searchParams.toString() ? `?${searchParams.toString()}` : "";
  const url = `${config.serverUrl}/api/desktop/products${query}`;

  const headers = config.token ? { Authorization: `Bearer ${config.token}` } : {};

  try {
    const res = await requestApi(url, { method: "GET", headers });
    if (res && res.data) {
      // Save local cache for offline usage
      fs.writeFileSync(getCachePath(app), JSON.stringify(res.data, null, 2), "utf-8");
      return { success: true, source: "online", products: res.data, total: res.total || res.data.length };
    }
  } catch (err) {
    // Offline fallback: load from cache
    if (fs.existsSync(getCachePath(app))) {
      try {
        const cached = JSON.parse(fs.readFileSync(getCachePath(app), "utf-8"));
        return { success: true, source: "offline-cache", products: cached, total: cached.length, warning: "Offline: Menggunakan data produk lokal." };
      } catch {}
    }
    throw err;
  }

  return { success: false, products: [] };
}

async function getCustomers(app, search = "") {
  const config = getServerConfig(app);
  const q = search ? `?search=${encodeURIComponent(search)}` : "";
  const url = `${config.serverUrl}/api/desktop/customers${q}`;
  const headers = config.token ? { Authorization: `Bearer ${config.token}` } : {};
  return await requestApi(url, { method: "GET", headers });
}

async function createCustomer(app, customerData) {
  const config = getServerConfig(app);
  const url = `${config.serverUrl}/api/desktop/customers/create`;
  const headers = config.token ? { Authorization: `Bearer ${config.token}` } : {};
  return await requestApi(url, {
    method: "POST",
    headers,
    body: JSON.stringify(customerData)
  });
}

async function submitTransaction(app, salePayload) {
  const config = getServerConfig(app);
  const url = `${config.serverUrl}/api/desktop/transaction`;
  const headers = config.token ? { Authorization: `Bearer ${config.token}` } : {};
  return await requestApi(url, {
    method: "POST",
    headers,
    body: JSON.stringify(salePayload)
  });
}

async function syncOffline(app, transactions) {
  const config = getServerConfig(app);
  const url = `${config.serverUrl}/api/desktop/sync-offline`;
  const headers = config.token ? { Authorization: `Bearer ${config.token}` } : {};
  return await requestApi(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ transactions })
  });
}

async function getReceipt(app, id) {
  const config = getServerConfig(app);
  const url = `${config.serverUrl}/api/desktop/receipt/${id}`;
  const headers = config.token ? { Authorization: `Bearer ${config.token}` } : {};
  return await requestApi(url, { method: "GET", headers });
}

async function fetchServerOrders(app, params = {}) {
  const config = getServerConfig(app);
  const searchParams = new URLSearchParams();
  if (params.page) searchParams.set("page", params.page);
  if (params.limit) searchParams.set("limit", params.limit);
  if (params.search) searchParams.set("search", params.search);
  if (params.date) searchParams.set("date", params.date);

  const qs = searchParams.toString();
  const url = `${config.serverUrl}/api/desktop/orders${qs ? `?${qs}` : ""}`;
  const headers = config.token ? { Authorization: `Bearer ${config.token}` } : {};
  return await requestApi(url, { method: "GET", headers });
}

function disconnectServer(app) {
  const current = getServerConfig(app);
  current.token = null;
  current.user = null;
  current.branch = null;
  current.isConnected = false;
  saveServerConfig(app, current);
  return current;
}

module.exports = {
  getServerConfig,
  saveServerConfig,
  testConnection,
  login,
  getBootstrap,
  getProducts,
  getCustomers,
  createCustomer,
  submitTransaction,
  syncOffline,
  getReceipt,
  fetchServerOrders,
  disconnectServer
};

