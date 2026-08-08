const fs = require("fs");
const path = require("path");
const db = require("./dbConnection");

let _cache = null;

function getAppRoot(app) {
  return app.isPackaged
    ? path.dirname(process.execPath)
    : path.resolve(__dirname, "..", "..");
}

function getEnvPath(app) {
  if (app.isPackaged) {
    return path.join(app.getPath("userData"), ".env");
  }
  return path.join(getAppRoot(app), ".env");
}

function readCsvPathFromEnv(app) {
  const envPath = getEnvPath(app);
  if (!fs.existsSync(envPath)) return "";

  const lines = fs.readFileSync(envPath, "utf-8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const eqIdx = trimmed.indexOf("=");
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
    if (key === "CSV_PATH" && val) {
      return val;
    }
  }

  return "";
}

function getDefaultAssetsDir(app) {
  const candidates = [
    path.join(getAppRoot(app), "assets"),
    path.join(process.resourcesPath || "", "assets"),
    path.join(app.getAppPath(), "assets")
  ].filter(Boolean);

  for (const dir of candidates) {
    if (fs.existsSync(dir)) {
      return dir;
    }
  }

  return candidates[0];
}

function resolveCatalogCsvDir(app) {
  const csvPath = readCsvPathFromEnv(app);
  if (!csvPath) {
    return getDefaultAssetsDir(app);
  }

  if (path.isAbsolute(csvPath)) {
    return csvPath;
  }

  return path.resolve(getAppRoot(app), csvPath);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let i = 0;
  let inQuotes = false;

  while (i < text.length) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      cell += char;
      i += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }

    if (char === ",") {
      row.push(cell);
      cell = "";
      i += 1;
      continue;
    }

    if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      i += 1;
      continue;
    }

    if (char === "\r") {
      i += 1;
      continue;
    }

    cell += char;
    i += 1;
  }

  row.push(cell);
  rows.push(row);

  return rows;
}

function normalizeRecords(parsedRows) {
  if (!parsedRows.length) return [];

  const header = parsedRows[0].map((h) => String(h || "").trim());
  const records = [];

  for (let r = 1; r < parsedRows.length; r += 1) {
    const row = parsedRows[r];
    if (!row || row.every((c) => String(c || "").trim() === "")) continue;

    const rec = {};
    for (let c = 0; c < header.length; c += 1) {
      rec[header[c]] = row[c] == null ? "" : String(row[c]);
    }
    records.push(rec);
  }

  return records;
}

function parseNumber(value) {
  if (value == null) return null;
  const cleaned = String(value).replace(/,/g, "").trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function normalizeText(value) {
  return String(value || "").trim();
}

function buildCatalog(filesData) {
  const productsMap = new Map();

  filesData.forEach(({ fileName, modifiedAt, records }) => {
    const ctxByHandle = new Map();

    records.forEach((rec, idx) => {
      const handle = normalizeText(rec.Handle);
      if (!handle) return;

      const prevCtx = ctxByHandle.get(handle) || {};
      const title = normalizeText(rec.Title) || prevCtx.title || handle;
      const vendor = normalizeText(rec.Vendor) || prevCtx.vendor || "";
      const type =
        normalizeText(rec.Type) ||
        normalizeText(rec["Product Category"]) ||
        prevCtx.type ||
        "Lainnya";
      const imageSrc =
        normalizeText(rec["Variant Image"]) ||
        normalizeText(rec["Image Src"]) ||
        prevCtx.imageUrl ||
        "";
      const status = (normalizeText(rec.Status) || prevCtx.status || "active").toLowerCase();

      ctxByHandle.set(handle, {
        title,
        vendor,
        type,
        imageUrl: imageSrc,
        status
      });

      if (!productsMap.has(handle)) {
        productsMap.set(handle, {
          id: handle,
          handle,
          title,
          vendor,
          category: type,
          imageUrl: imageSrc,
          status,
          variants: new Map()
        });
      }

      const p = productsMap.get(handle);
      p.title = title || p.title;
      p.vendor = vendor || p.vendor;
      p.category = type || p.category;
      p.imageUrl = imageSrc || p.imageUrl;
      p.status = status || p.status;

      const variantSku = normalizeText(rec["Variant SKU"]);
      const optionValue = normalizeText(rec["Option1 Value"]);
      const variantTitle = optionValue || "Default";
      const price = parseNumber(rec["Variant Price"]);

      // Shopify export contains one row per variant; skip non-variant fragments.
      if (price === null && !variantSku && !optionValue) {
        return;
      }

      const variantKey = `${handle}::${variantSku || variantTitle || idx}`;
      p.variants.set(variantKey, {
        id: variantSku || `${handle}-${idx}`,
        sku: variantSku,
        title: variantTitle,
        price: price || 0,
        grams: parseNumber(rec["Variant Grams"]) || 0,
        weightUnit: normalizeText(rec["Variant Weight Unit"]),
        inventoryQty: parseNumber(rec["Variant Inventory Qty"]),
        imageUrl: normalizeText(rec["Variant Image"]) || imageSrc,
        sourceFile: fileName,
        sourceModifiedAt: modifiedAt
      });
    });
  });

  const products = Array.from(productsMap.values())
    .filter((p) => p.status !== "draft" && p.status !== "archived")
    .map((p) => ({
      id: p.id,
      handle: p.handle,
      title: p.title,
      vendor: p.vendor,
      category: p.category || "Lainnya",
      imageUrl: p.imageUrl,
      variants: Array.from(p.variants.values()).sort((a, b) => a.price - b.price)
    }))
    .filter((p) => p.variants.length > 0)
    .sort((a, b) => a.title.localeCompare(b.title, "id"));

  const categories = [...new Set(products.map((p) => p.category).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "id")
  );

  return { products, categories };
}

function getCatalogSignature(csvDir, csvFiles) {
  return csvFiles
    .map((f) => `${f.name}:${f.stats.mtimeMs}:${f.stats.size}`)
    .join("|") + `|dir:${csvDir}`;
}

async function saveCatalogToDatabase(catalog) {
  const pool = await db.getPool();
  if (!pool) return;

  const conn = await pool.getConnection();
  const syncedAt = new Date();

  try {
    await conn.beginTransaction();

    // Replace full catalog snapshot so DB is always aligned with latest CSV load.
    await conn.execute("DELETE FROM catalog_variants");
    await conn.execute("DELETE FROM catalog_products");

    for (const product of catalog.products || []) {
      const firstVariant = (product.variants && product.variants[0]) || null;
      const sourceFile = firstVariant?.sourceFile || null;
      const sourceModifiedAt = firstVariant?.sourceModifiedAt ? new Date(firstVariant.sourceModifiedAt) : null;

      await conn.execute(
        `INSERT INTO catalog_products
          (id, handle, title, vendor, category, image_url, source_file, source_modified_at, synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          product.id,
          product.handle,
          product.title,
          product.vendor || null,
          product.category || null,
          product.imageUrl || null,
          sourceFile,
          sourceModifiedAt,
          syncedAt
        ]
      );

      for (const variant of product.variants || []) {
        await conn.execute(
          `INSERT INTO catalog_variants
            (id, product_id, sku, title, price, grams, weight_unit, inventory_qty, image_url, source_file, source_modified_at, synced_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            variant.id,
            product.id,
            variant.sku || null,
            variant.title || null,
            Number(variant.price || 0),
            Number(variant.grams || 0),
            variant.weightUnit || null,
            variant.inventoryQty == null ? null : Number(variant.inventoryQty),
            variant.imageUrl || null,
            variant.sourceFile || null,
            variant.sourceModifiedAt ? new Date(variant.sourceModifiedAt) : null,
            syncedAt
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

async function readCatalogFromAssets(app, options = {}) {
  const { forceReload = false } = options;
  const csvDir = resolveCatalogCsvDir(app);

  if (!fs.existsSync(csvDir)) {
    throw new Error(`Folder CSV tidak ditemukan: ${csvDir}`);
  }

  const fileNames = fs.readdirSync(csvDir);
  const csvFiles = fileNames
    .filter((name) => name.toLowerCase().endsWith(".csv"))
    .map((name) => {
      const fullPath = path.join(csvDir, name);
      return {
        name,
        fullPath,
        stats: fs.statSync(fullPath)
      };
    })
    .sort((a, b) => a.stats.mtimeMs - b.stats.mtimeMs);

  if (!csvFiles.length) {
    throw new Error(`Tidak ada file .csv di folder CSV: ${csvDir}`);
  }

  const signature = getCatalogSignature(csvDir, csvFiles);
  if (!forceReload && _cache && _cache.signature === signature) {
    return _cache.data;
  }

  const filesData = csvFiles.map((f) => {
    const raw = fs.readFileSync(f.fullPath, "utf-8");
    const records = normalizeRecords(parseCsv(raw));
    return {
      fileName: f.name,
      modifiedAt: f.stats.mtime.toISOString(),
      records
    };
  });

  const built = buildCatalog(filesData);
  const data = {
    ...built,
    sourceDirectory: csvDir,
    sourceFiles: filesData.map((f) => ({
      fileName: f.fileName,
      modifiedAt: f.modifiedAt,
      rows: f.records.length
    })),
    sourceFilesCount: filesData.length,
    loadedAt: new Date().toISOString()
  };

  if (db.isConnected()) {
    try {
      await saveCatalogToDatabase(data);
    } catch (err) {
      // Do not block POS flow if catalog DB sync fails.
      console.error("Gagal menyimpan katalog CSV ke database:", err.message);
    }
  }

  _cache = { signature, data };
  return data;
}

module.exports = {
  readCatalogFromAssets
};
