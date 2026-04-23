const fs = require("fs");
const path = require("path");

let _cache = null;

function getAppRoot(app) {
  return app.isPackaged
    ? path.dirname(process.execPath)
    : path.resolve(__dirname, "..", "..");
}

function getAssetsDir(app) {
  return path.join(getAppRoot(app), "assets");
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

function getCatalogSignature(csvFiles) {
  return csvFiles
    .map((f) => `${f.name}:${f.stats.mtimeMs}:${f.stats.size}`)
    .join("|");
}

function readCatalogFromAssets(app, options = {}) {
  const { forceReload = false } = options;
  const assetsDir = getAssetsDir(app);

  if (!fs.existsSync(assetsDir)) {
    throw new Error(`Folder assets tidak ditemukan: ${assetsDir}`);
  }

  const fileNames = fs.readdirSync(assetsDir);
  const csvFiles = fileNames
    .filter((name) => name.toLowerCase().endsWith(".csv"))
    .map((name) => {
      const fullPath = path.join(assetsDir, name);
      return {
        name,
        fullPath,
        stats: fs.statSync(fullPath)
      };
    })
    .sort((a, b) => a.stats.mtimeMs - b.stats.mtimeMs);

  if (!csvFiles.length) {
    throw new Error("Tidak ada file .csv di folder assets.");
  }

  const signature = getCatalogSignature(csvFiles);
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
    sourceFiles: filesData.map((f) => ({
      fileName: f.fileName,
      modifiedAt: f.modifiedAt,
      rows: f.records.length
    })),
    sourceFilesCount: filesData.length,
    loadedAt: new Date().toISOString()
  };

  _cache = { signature, data };
  return data;
}

module.exports = {
  readCatalogFromAssets
};
