const fs = require("fs");
const path = require("path");
const { resolveDataDir } = require("./dataPath");
const db = require("./dbConnection");

const STORE_FILE = "manual-products.json";

function getStorePath(app) {
  return path.join(resolveDataDir(app), STORE_FILE);
}

function readStore(app) {
  const filePath = getStorePath(app);
  if (!fs.existsSync(filePath)) {
    return { version: 1, products: [] };
  }

  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw || "{}");
    if (!Array.isArray(parsed.products)) {
      return { version: 1, products: [] };
    }
    return {
      version: Number(parsed.version || 1),
      products: parsed.products
    };
  } catch {
    return { version: 1, products: [] };
  }
}

function writeStore(app, store) {
  const filePath = getStorePath(app);
  fs.writeFileSync(filePath, JSON.stringify(store, null, 2), "utf-8");
}

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

function normalizeVariant(input, idx) {
  const name = normalizeText(input?.name) || `Varian ${idx + 1}`;
  const price = normalizeNumber(input?.price, 0);

  return {
    id: normalizeText(input?.id) || makeId("MVAR"),
    name,
    price: Math.max(0, price)
  };
}

function normalizeProduct(input) {
  const name = normalizeText(input?.name);
  if (!name) {
    throw new Error("Nama produk wajib diisi.");
  }

  const sellPrice = Math.max(0, normalizeNumber(input?.sellPrice, 0));
  const variantsInput = Array.isArray(input?.variants) ? input.variants : [];
  const variants = variantsInput.length
    ? variantsInput.map((v, idx) => normalizeVariant(v, idx))
    : [
        {
          id: makeId("MVAR"),
          name: normalizeText(input?.defaultVariantName) || "Default",
          price: sellPrice
        }
      ];

  return {
    id: normalizeText(input?.id) || makeId("MPROD"),
    name,
    description: normalizeText(input?.description),
    category: normalizeText(input?.category) || "Lainnya",
    sku: normalizeText(input?.sku),
    unit: normalizeText(input?.unit) || "Pcs",
    sellPrice,
    costPrice: Math.max(0, normalizeNumber(input?.costPrice, 0)),
    stockQty: Math.max(0, normalizeNumber(input?.stockQty, 0)),
    imagePath: normalizeText(input?.imagePath),
    active: input?.active !== false,
    variants
  };
}

function toCatalogProduct(product) {
  const handle = String(product.id);
  return {
    id: handle,
    handle,
    title: product.name,
    vendor: "Manual Store",
    category: product.category || "Lainnya",
    imageUrl: product.imagePath || "",
    sourceType: "manual",
    manualMeta: {
      sku: product.sku,
      unit: product.unit,
      stockQty: product.stockQty,
      sellPrice: product.sellPrice,
      costPrice: product.costPrice,
      description: product.description
    },
    variants: (product.variants || []).map((v) => ({
      id: v.id,
      sku: product.sku || "",
      title: v.name || "Default",
      price: Number(v.price || 0),
      grams: 0,
      weightUnit: "",
      inventoryQty: product.stockQty,
      imageUrl: product.imagePath || "",
      sourceFile: "manual-products",
      sourceModifiedAt: product.updatedAt || product.createdAt || new Date().toISOString()
    }))
  };
}

function buildCatalogFromStore(store) {
  const activeProducts = (store.products || []).filter((p) => p.active !== false);
  const products = activeProducts
    .map((p) => toCatalogProduct(p))
    .sort((a, b) => a.title.localeCompare(b.title, "id"));

  const categories = [...new Set(products.map((p) => p.category).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "id")
  );

  return {
    products,
    categories,
    sourceType: "manual",
    sourceFilesCount: 1
  };
}

async function syncStoreToDatabase(store) {
  const pool = await db.getPool();
  if (!pool) return;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute("DELETE FROM manual_product_variants");
    await conn.execute("DELETE FROM manual_products");

    for (const p of store.products || []) {
      await conn.execute(
        `INSERT INTO manual_products
          (id, name, description, category, sku, unit, sell_price, cost_price, stock_qty, image_path, active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          p.id,
          p.name,
          p.description || null,
          p.category || null,
          p.sku || null,
          p.unit || "Pcs",
          Number(p.sellPrice || 0),
          Number(p.costPrice || 0),
          Number(p.stockQty || 0),
          p.imagePath || null,
          p.active === false ? 0 : 1,
          p.createdAt ? new Date(p.createdAt) : new Date(),
          p.updatedAt ? new Date(p.updatedAt) : new Date()
        ]
      );

      for (const v of p.variants || []) {
        await conn.execute(
          `INSERT INTO manual_product_variants
            (id, product_id, name, price, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            v.id,
            p.id,
            v.name || "Default",
            Number(v.price || 0),
            p.createdAt ? new Date(p.createdAt) : new Date(),
            p.updatedAt ? new Date(p.updatedAt) : new Date()
          ]
        );
      }
    }

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function readStoreFromDatabase() {
  const pool = await db.getPool();
  if (!pool) return { version: 1, products: [] };

  const [productRows] = await pool.execute("SELECT * FROM manual_products ORDER BY name ASC");
  if (!productRows.length) {
    return { version: 1, products: [] };
  }

  const [variantRows] = await pool.execute("SELECT * FROM manual_product_variants");
  const varMap = new Map();
  for (const row of variantRows) {
    const list = varMap.get(row.product_id) || [];
    list.push({
      id: row.id,
      name: row.name,
      price: Number(row.price || 0)
    });
    varMap.set(row.product_id, list);
  }

  const products = productRows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description || "",
    category: row.category || "Lainnya",
    sku: row.sku || "",
    unit: row.unit || "Pcs",
    sellPrice: Number(row.sell_price || 0),
    costPrice: Number(row.cost_price || 0),
    stockQty: Number(row.stock_qty || 0),
    imagePath: row.image_path || "",
    active: Number(row.active) !== 0,
    variants: varMap.get(row.id) || [],
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : new Date().toISOString()
  }));

  return { version: 1, products };
}

async function hydrateFromDatabase(app) {
  if (!db.isConnected()) return;

  const dbStore = await readStoreFromDatabase();
  if (!Array.isArray(dbStore.products) || dbStore.products.length === 0) return;

  const jsonStore = readStore(app);
  if (!Array.isArray(jsonStore.products) || jsonStore.products.length === 0) {
    writeStore(app, dbStore);
  }
}

async function getManualCatalog(app) {
  let store = readStore(app);

  if (db.isConnected()) {
    try {
      const dbStore = await readStoreFromDatabase();
      if (dbStore.products.length > 0) {
        store = dbStore;
      } else {
        await syncStoreToDatabase(store);
      }
    } catch {
      // fallback to JSON store
    }
  }

  const catalog = buildCatalogFromStore(store);
  return {
    ...catalog,
    productsRaw: store.products || [],
    sourceDirectory: getStorePath(app),
    loadedAt: new Date().toISOString()
  };
}

async function createManualProduct(app, payload) {
  const store = readStore(app);
  const now = new Date().toISOString();
  const normalized = normalizeProduct(payload);

  if (store.products.some((p) => p.id === normalized.id || p.name.toLowerCase() === normalized.name.toLowerCase())) {
    throw new Error("Produk manual dengan nama yang sama sudah ada.");
  }

  const next = {
    ...normalized,
    createdAt: now,
    updatedAt: now
  };

  store.products.push(next);
  writeStore(app, store);

  if (db.isConnected()) {
    await syncStoreToDatabase(store);
  }

  return next;
}

async function updateManualProduct(app, payload) {
  const store = readStore(app);
  const id = normalizeText(payload?.id);
  if (!id) throw new Error("ID produk tidak valid.");

  const idx = store.products.findIndex((p) => p.id === id);
  if (idx < 0) throw new Error("Produk tidak ditemukan.");

  const normalized = normalizeProduct({ ...store.products[idx], ...payload, id });
  store.products[idx] = {
    ...store.products[idx],
    ...normalized,
    id,
    createdAt: store.products[idx].createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  writeStore(app, store);
  if (db.isConnected()) {
    await syncStoreToDatabase(store);
  }

  return store.products[idx];
}

async function deleteManualProduct(app, id) {
  const store = readStore(app);
  const productId = normalizeText(id);
  const before = store.products.length;
  store.products = store.products.filter((p) => p.id !== productId);

  if (store.products.length === before) {
    throw new Error("Produk tidak ditemukan.");
  }

  writeStore(app, store);
  if (db.isConnected()) {
    await syncStoreToDatabase(store);
  }

  return { success: true };
}

async function deleteManyManualProducts(app, ids) {
  const keepIds = new Set(Array.isArray(ids) ? ids.map((x) => normalizeText(x)) : []);
  if (!keepIds.size) return { success: true, deleted: 0 };

  const store = readStore(app);
  const before = store.products.length;
  store.products = store.products.filter((p) => !keepIds.has(p.id));
  const deleted = before - store.products.length;

  writeStore(app, store);
  if (db.isConnected()) {
    await syncStoreToDatabase(store);
  }

  return { success: true, deleted };
}

async function syncAppStoreToDatabase(app) {
  if (!db.isConnected()) return;
  const store = readStore(app);
  await syncStoreToDatabase(store);
}

module.exports = {
  getManualCatalog,
  createManualProduct,
  updateManualProduct,
  deleteManualProduct,
  deleteManyManualProducts,
  hydrateFromDatabase,
  syncStoreToDatabase,
  syncAppStoreToDatabase
};
