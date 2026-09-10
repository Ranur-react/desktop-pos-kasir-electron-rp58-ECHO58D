const fs = require("fs");
const path = require("path");
const { resolveDataDir } = require("./dataPath");
const db = require("./dbConnection");
const apiService = require("./apiService");

function getDateKey() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function getOrdersFilePath(app) {
  return path.join(resolveDataDir(app), `orders-${getDateKey()}.json`);
}

function readOrders(app) {
  const filePath = getOrdersFilePath(app);
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, "utf-8");
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeOrders(app, orders) {
  const filePath = getOrdersFilePath(app);
  fs.writeFileSync(filePath, JSON.stringify(orders, null, 2), "utf-8");
}

// Database functions
async function readOrdersFromDB() {
  try {
    const pool = await db.getPool();
    if (!pool) return [];

    const today = getDateKey();
    const [orderRows] = await pool.execute(
      `SELECT * FROM orders 
       WHERE created_date = ? 
       ORDER BY created_at DESC`,
      [today]
    );

    if (orderRows.length === 0) return [];

    const orders = [];
    for (const orderRow of orderRows) {
      const [itemRows] = await pool.execute(
        `SELECT * FROM order_items WHERE order_id = ?`,
        [orderRow.id]
      );

      orders.push({
        id: orderRow.id,
        items: itemRows.map((item) => ({
          lineId: item.line_id,
          title: item.title,
          price: Number(item.price),
          qty: item.qty,
          lineTotal: Number(item.line_total),
          sku: item.sku,
          variantTitle: item.variant_title,
          productHandle: item.product_handle,
          returStatus: item.retur_status
        })),
        subtotal: Number(orderRow.subtotal),
        paymentMethod: orderRow.payment_method,
        cashGiven: orderRow.cash_given ? Number(orderRow.cash_given) : null,
        change: Number(orderRow.change_amount),
        qrisMeta: orderRow.qris_meta ? JSON.parse(orderRow.qris_meta) : null,
        status: orderRow.status,
        returHistory: [],
        createdAt: orderRow.created_at.toISOString(),
        paidAt: orderRow.paid_at.toISOString()
      });
    }

    return orders;
  } catch (err) {
    console.error("Error reading orders from DB:", err);
    return [];
  }
}

async function writeOrderToDB(order) {
  try {
    const pool = await db.getPool();
    if (!pool) return null;

    const createdAt = new Date(order.createdAt);
    const paidAt = new Date(order.paidAt);
    const createdDate = createdAt.toISOString().split("T")[0];

    // Insert order
    await pool.execute(
      `INSERT INTO orders (id, subtotal, payment_method, cash_given, change_amount, qris_meta, status, created_at, created_date, paid_at) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        order.id,
        order.subtotal,
        order.paymentMethod,
        order.cashGiven,
        order.change,
        order.qrisMeta ? JSON.stringify(order.qrisMeta) : null,
        order.status,
        createdAt,
        createdDate,
        paidAt
      ]
    );

    // Insert order items
    for (const item of order.items) {
      await pool.execute(
        `INSERT INTO order_items (line_id, order_id, title, price, qty, line_total, sku, variant_title, product_handle, retur_status, created_at) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          item.lineId,
          order.id,
          item.title,
          item.price,
          item.qty,
          item.lineTotal,
          item.sku || null,
          item.variantTitle || null,
          item.productHandle || null,
          item.returStatus || null,
          createdAt
        ]
      );
    }

    return order;
  } catch (err) {
    console.error("Error writing order to DB:", err);
    return null;
  }
}

// Public functions
async function getTodayOrders(app) {
  if (db.isConnected()) {
    const fromDb = await readOrdersFromDB();
    if (Array.isArray(fromDb) && fromDb.length > 0) {
      return fromDb;
    }
  }
  return readOrders(app).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function createOrder(app, payload) {
  const {
    items = [],
    paymentMethod = "cash",
    cashGiven = null,
    qrisMeta = null,
    idpelanggan = 0,
    diskon = 0,
    cashierName = "Kasir",
    customerName = "Pelanggan Umum",
    printAction = "hanya_cetak",
    bankAccount = null
  } = payload || {};

  const now = new Date();
  const subtotal = items.reduce((s, i) => s + (Number(i.price) || 0) * (Number(i.qty) || 0), 0);
  const totalBayar = Math.max(subtotal - Number(diskon || 0), 0);
  const cashNum = Number(cashGiven);
  const change = paymentMethod === "cash" && Number.isFinite(cashNum) ? Math.max(cashNum - totalBayar, 0) : 0;

  const localId = `ORD-${now.getTime()}`;
  let nofaktur = null;
  let idJual = null;
  let synced = false;
  let syncError = null;

  // 1. Attempt online REST API transaction to web hosting
  try {
    const salePayload = {
      idpelanggan: Number(idpelanggan) || 0,
      subtotal: subtotal,
      diskon_jual: Number(diskon) || 0,
      total_bayar: totalBayar,
      metode_bayar: paymentMethod === "cash" ? "tunai" : (paymentMethod === "qris" || paymentMethod === "card" ? "card" : "hutang"),
      jumlah_uang: paymentMethod === "cash" ? cashNum : totalBayar,
      bank_account: bankAccount,
      aksi: printAction || "hanya_cetak",
      offline_id: localId,
      items: items.map((item) => ({
        id_produk: item.productId || item.id_produk || item.id,
        jumlah: Number(item.qty) || 1,
        harga_jual: Number(item.price) || 0,
        satuan_id: item.satuan_id || 1,
        harga_id: item.harga_id || 0
      }))
    };

    const apiRes = await apiService.submitTransaction(app, salePayload);
    if (apiRes && apiRes.status === "success" && apiRes.data) {
      nofaktur = apiRes.data.nofaktur;
      idJual = apiRes.data.id_jual || apiRes.data.idjual;
      synced = true;
    }
  } catch (err) {
    // If the server was reached and returned a business validation error (e.g. 422 out of stock, 400, etc.),
    // do NOT swallow it into offline queue! Throw it so the cashier is alerted immediately.
    const isBusinessValidationError = err.status === 422 || err.status === 400 || (err.data && err.data.status === "error");
    if (isBusinessValidationError) {
      console.error("[POS] Online transaction rejected by server:", err.message);
      throw err;
    }

    console.warn("[POS] Online transaction failed due to network unreachable, saving to offline queue:", err.message);
    syncError = err.message;
    synced = false;
  }

  const finalOrderId = nofaktur || localId;
  const order = {
    id: finalOrderId,
    nofaktur: nofaktur || null,
    id_jual: idJual || null,
    offline_id: localId,
    channel: "desktop",
    synced: synced,
    syncError: syncError,
    idpelanggan: Number(idpelanggan) || 0,
    customerName: customerName,
    cashierName: cashierName,
    items: items.map((item, idx) => ({
      lineId: `LN-${now.getTime()}-${idx}`,
      productId: item.productId || item.id_produk || item.id,
      title: item.title || item.nama_produk,
      price: Number(item.price) || 0,
      qty: Number(item.qty) || 1,
      lineTotal: (Number(item.price) || 0) * (Number(item.qty) || 1),
      sku: item.sku || item.barcode || null,
      barcode: item.barcode || item.sku || null,
      variantTitle: item.variantTitle || null,
      productHandle: item.productHandle || null,
      returStatus: null
    })),
    subtotal,
    diskon: Number(diskon) || 0,
    totalBayar,
    paymentMethod,
    cashGiven: paymentMethod === "cash" ? cashNum : null,
    change,
    qrisMeta: paymentMethod === "qris" ? (qrisMeta || { paid: true }) : null,
    status: "paid",
    returHistory: [],
    createdAt: now.toISOString(),
    paidAt: now.toISOString()
  };

  // Always keep JSON history as local backup / offline queue
  const orders = readOrders(app);
  orders.push(order);
  writeOrders(app, orders);

  // Mirror to SQL when direct connection is configured
  if (db.isConnected()) {
    writeOrderToDB(order).catch((err) => {
      console.error("Async DB write order failed:", err);
    });
  }

  return order;
}

function returOrderItem(app, { orderId, lineId, reason }) {
  if (db.isConnected()) {
    return returOrderItemDB(orderId, lineId, reason, app);
  }

  const orders = readOrders(app);
  const order = orders.find((o) => o.id === orderId || o.nofaktur === orderId || o.offline_id === orderId);
  if (!order) throw new Error("Order tidak ditemukan.");
  if (order.status !== "paid" && order.status !== "partial-return") {
    throw new Error("Order belum dibayar, tidak bisa retur.");
  }

  const line = order.items.find((l) => l.lineId === lineId);
  if (!line) throw new Error("Item tidak ditemukan dalam order.");
  if (line.returStatus === "returned") throw new Error("Item ini sudah diretur sebelumnya.");

  const now = new Date();
  line.returStatus = "returned";

  order.returHistory.push({
    lineId,
    title: line.title,
    price: line.price,
    qty: line.qty,
    lineTotal: line.lineTotal,
    reason: reason || "",
    returAt: now.toISOString()
  });

  order.subtotal = order.items
    .filter((i) => i.returStatus !== "returned")
    .reduce((s, i) => s + i.lineTotal, 0);

  if (order.paymentMethod === "cash" && order.cashGiven !== null) {
    order.change = order.cashGiven - order.subtotal;
  }

  const allReturned = order.items.every((i) => i.returStatus === "returned");
  order.status = allReturned ? "fully-returned" : "partial-return";

  writeOrders(app, orders);
  return order;
}

async function returOrderItemDB(orderId, lineId, reason, app) {
  try {
    const pool = await db.getPool();
    if (!pool) {
      throw new Error("Koneksi database tidak tersedia.");
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const [orderRows] = await conn.execute("SELECT * FROM orders WHERE id = ? LIMIT 1", [orderId]);
      if (!orderRows.length) {
        throw new Error("Order tidak ditemukan.");
      }

      const [lineRows] = await conn.execute("SELECT * FROM order_items WHERE line_id = ? LIMIT 1", [lineId]);
      if (!lineRows.length) {
        throw new Error("Item tidak ditemukan dalam order.");
      }

      const line = lineRows[0];
      if (line.retur_status === "returned") {
        throw new Error("Item ini sudah diretur sebelumnya.");
      }

      await conn.execute("UPDATE order_items SET retur_status = 'returned' WHERE line_id = ?", [lineId]);

      const [remainingRows] = await conn.execute(
        "SELECT COALESCE(SUM(line_total), 0) AS subtotal FROM order_items WHERE order_id = ? AND (retur_status IS NULL OR retur_status <> 'returned')",
        [orderId]
      );
      const nextSubtotal = Number(remainingRows[0]?.subtotal || 0);

      const [countRows] = await conn.execute(
        "SELECT COUNT(*) AS total, SUM(CASE WHEN retur_status = 'returned' THEN 1 ELSE 0 END) AS returned_count FROM order_items WHERE order_id = ?",
        [orderId]
      );
      const totalLines = Number(countRows[0]?.total || 0);
      const returnedCount = Number(countRows[0]?.returned_count || 0);
      const allReturned = totalLines > 0 && returnedCount === totalLines;

      const order = orderRows[0];
      const nextStatus = allReturned ? "fully-returned" : "partial-return";
      const nextChange = order.payment_method === "cash" ? Number(order.cash_given || 0) - nextSubtotal : Number(order.change_amount || 0);

      await conn.execute(
        "UPDATE orders SET subtotal = ?, change_amount = ?, status = ? WHERE id = ?",
        [nextSubtotal, nextChange, nextStatus, orderId]
      );

      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    // Mirror retur to JSON backup.
    const jsonOrders = readOrders(app);
    const targetOrder = jsonOrders.find((o) => o.id === orderId || o.nofaktur === orderId || o.offline_id === orderId);
    if (targetOrder) {
      const targetLine = targetOrder.items.find((l) => l.lineId === lineId);
      if (targetLine && targetLine.returStatus !== "returned") {
        targetLine.returStatus = "returned";
        targetOrder.returHistory = targetOrder.returHistory || [];
        targetOrder.returHistory.push({
          lineId,
          title: targetLine.title,
          price: targetLine.price,
          qty: targetLine.qty,
          lineTotal: targetLine.lineTotal,
          reason: reason || "",
          returAt: new Date().toISOString()
        });
        targetOrder.subtotal = targetOrder.items
          .filter((i) => i.returStatus !== "returned")
          .reduce((s, i) => s + i.lineTotal, 0);
        if (targetOrder.paymentMethod === "cash" && targetOrder.cashGiven != null) {
          targetOrder.change = Number(targetOrder.cashGiven) - Number(targetOrder.subtotal || 0);
        }
        targetOrder.status = targetOrder.items.every((i) => i.returStatus === "returned")
          ? "fully-returned"
          : "partial-return";
        writeOrders(app, jsonOrders);
      }
    }

    const latest = await getOrderByIdDB(orderId);
    if (!latest) {
      throw new Error("Order retur tidak ditemukan setelah pembaruan.");
    }
    return latest;
  } catch (err) {
    throw err;
  }
}

async function getOrderById(app, orderId) {
  if (db.isConnected()) {
    const fromDb = await getOrderByIdDB(orderId);
    if (fromDb) return fromDb;
  }
  return readOrders(app).find((o) => o.id === orderId || o.nofaktur === orderId || o.offline_id === orderId) || null;
}

async function getOrderByIdDB(orderId) {
  try {
    const pool = await db.getPool();
    if (!pool) return null;

    const [orderRows] = await pool.execute(
      `SELECT * FROM orders WHERE id = ?`,
      [orderId]
    );

    if (orderRows.length === 0) return null;

    const orderRow = orderRows[0];
    const [itemRows] = await pool.execute(
      `SELECT * FROM order_items WHERE order_id = ?`,
      [orderId]
    );

    return {
      id: orderRow.id,
      items: itemRows.map((item) => ({
        lineId: item.line_id,
        title: item.title,
        price: Number(item.price),
        qty: item.qty,
        lineTotal: Number(item.line_total),
        sku: item.sku,
        variantTitle: item.variant_title,
        productHandle: item.product_handle,
        returStatus: item.retur_status
      })),
      subtotal: Number(orderRow.subtotal),
      paymentMethod: orderRow.payment_method,
      cashGiven: orderRow.cash_given ? Number(orderRow.cash_given) : null,
      change: Number(orderRow.change_amount),
      qrisMeta: orderRow.qris_meta ? JSON.parse(orderRow.qris_meta) : null,
      status: orderRow.status,
      returHistory: [],
      createdAt: orderRow.created_at.toISOString(),
      paidAt: orderRow.paid_at.toISOString()
    };
  } catch (err) {
    console.error("Error getting order from DB:", err);
    return null;
  }
}

async function getTodayOrdersSummary(app) {
  if (db.isConnected()) {
    const fromDb = await getTodayOrdersSummaryDB();
    if (Number(fromDb.totalSales || 0) > 0 || Number(fromDb.totalOrders || 0) > 0) {
      return fromDb;
    }
  }

  const orders = readOrders(app);
  const paidOrders = orders.filter((o) => o.status === "paid" || o.status === "partial-return");

  const totalSales = paidOrders.reduce((s, o) => s + o.subtotal, 0);
  const totalOrders = paidOrders.length;
  const totalCash = paidOrders
    .filter((o) => o.paymentMethod === "cash")
    .reduce((s, o) => s + o.subtotal, 0);
  const totalQris = paidOrders
    .filter((o) => o.paymentMethod === "qris")
    .reduce((s, o) => s + o.subtotal, 0);
  const totalReturned = orders.reduce((s, o) => {
    return s + o.returHistory.reduce((rs, r) => rs + r.lineTotal, 0);
  }, 0);

  return { totalSales, totalOrders, totalCash, totalQris, totalReturned };
}

async function getTodayOrdersSummaryDB() {
  try {
    const pool = await db.getPool();
    if (!pool) return { totalSales: 0, totalOrders: 0, totalCash: 0, totalQris: 0, totalReturned: 0 };

    const today = getDateKey();

    const [paidOrders] = await pool.execute(
      `SELECT * FROM orders 
       WHERE created_date = ? AND (status = 'paid' OR status = 'partial-return')`,
      [today]
    );

    if (paidOrders.length === 0) {
      return { totalSales: 0, totalOrders: 0, totalCash: 0, totalQris: 0, totalReturned: 0 };
    }

    const totalSales = paidOrders.reduce((s, o) => s + Number(o.subtotal), 0);
    const totalOrders = paidOrders.length;
    const totalCash = paidOrders
      .filter((o) => o.payment_method === "cash")
      .reduce((s, o) => s + Number(o.subtotal), 0);
    const totalQris = paidOrders
      .filter((o) => o.payment_method === "qris")
      .reduce((s, o) => s + Number(o.subtotal), 0);

    const [allOrders] = await pool.execute(
      `SELECT * FROM order_items WHERE retur_status = 'returned' AND order_id IN (
        SELECT id FROM orders WHERE created_date = ?
      )`,
      [today]
    );

    const totalReturned = allOrders.reduce((s, item) => s + Number(item.line_total), 0);

    return { totalSales, totalOrders, totalCash, totalQris, totalReturned };
  } catch (err) {
    console.error("Error getting summary from DB:", err);
    return { totalSales: 0, totalOrders: 0, totalCash: 0, totalQris: 0, totalReturned: 0 };
  }
}

function getOrdersByDateRangeJSON(app, from, to) {
  const dataDir = resolveDataDir(app);
  let files;
  try {
    files = fs.readdirSync(dataDir);
  } catch {
    return [];
  }

  const results = [];
  for (const file of files) {
    const match = file.match(/^orders-(\d{4}-\d{2}-\d{2})\.json$/);
    if (!match) continue;
    const dateKey = match[1];
    if (dateKey < from || dateKey > to) continue;
    const filePath = path.join(dataDir, file);
    try {
      const raw = fs.readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) results.push(...parsed);
    } catch {
      // skip corrupted files
    }
  }

  return results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function getOrdersByDateRangeDB(from, to) {
  try {
    const pool = await db.getPool();
    if (!pool) return [];

    const [orderRows] = await pool.execute(
      `SELECT * FROM orders WHERE created_date BETWEEN ? AND ? ORDER BY created_at DESC`,
      [from, to]
    );

    if (orderRows.length === 0) return [];

    const orders = [];
    for (const orderRow of orderRows) {
      const [itemRows] = await pool.execute(
        `SELECT * FROM order_items WHERE order_id = ?`,
        [orderRow.id]
      );
      const [returRows] = await pool.execute(
        `SELECT * FROM order_retur_history WHERE order_id = ?`,
        [orderRow.id]
      ).catch(() => [[]]);

      orders.push({
        id: orderRow.id,
        items: itemRows.map((item) => ({
          lineId: item.line_id,
          title: item.title,
          price: Number(item.price),
          qty: item.qty,
          lineTotal: Number(item.line_total),
          sku: item.sku,
          variantTitle: item.variant_title,
          productHandle: item.product_handle,
          returStatus: item.retur_status
        })),
        subtotal: Number(orderRow.subtotal),
        paymentMethod: orderRow.payment_method,
        cashGiven: orderRow.cash_given ? Number(orderRow.cash_given) : null,
        change: Number(orderRow.change_amount),
        qrisMeta: orderRow.qris_meta ? JSON.parse(orderRow.qris_meta) : null,
        status: orderRow.status,
        returHistory: Array.isArray(returRows) ? returRows.map((rh) => ({
          lineId: rh.line_id,
          title: rh.title,
          price: Number(rh.price),
          qty: rh.qty,
          lineTotal: Number(rh.line_total),
          reason: rh.reason || "",
          returAt: rh.retur_at ? new Date(rh.retur_at).toISOString() : ""
        })) : [],
        createdAt: orderRow.created_at.toISOString(),
        paidAt: orderRow.paid_at.toISOString()
      });
    }
    return orders;
  } catch (err) {
    console.error("Error getting orders by date range from DB:", err);
    return [];
  }
}

async function getOrdersByDateRange(app, { from, to }) {
  if (db.isConnected()) {
    const fromDb = await getOrdersByDateRangeDB(from, to);
    if (Array.isArray(fromDb) && fromDb.length > 0) {
      return fromDb;
    }
  }
  return getOrdersByDateRangeJSON(app, from, to);
}

function getAllOrdersForSync(app) {
  const dataDir = resolveDataDir(app);
  let files = [];
  try {
    files = fs.readdirSync(dataDir);
  } catch {
    return [];
  }

  const results = [];
  for (const file of files) {
    const match = file.match(/^orders-(\d{4}-\d{2}-\d{2})\.json$/);
    if (!match) continue;
    const filePath = path.join(dataDir, file);
    try {
      const raw = fs.readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        results.push(...parsed.filter((item) => item && item.id));
      }
    } catch {
      // skip corrupted files
    }
  }

  return results.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
}

async function syncOrderToDatabase(app, order) {
  if (!db.isConnected() || !order || !order.id) return { success: false, synced: 0, message: "MySQL belum terhubung." };

  const pool = await db.getPool();
  const conn = await pool.getConnection();
  try {
    const createdAt = new Date(order.createdAt || Date.now());
    const createdDate = createdAt.toISOString().split("T")[0];
    const paidAt = new Date(order.paidAt || order.createdAt || Date.now());

    await conn.execute(
      `INSERT INTO orders (id, subtotal, payment_method, cash_given, change_amount, qris_meta, status, created_at, created_date, paid_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         subtotal = VALUES(subtotal),
         payment_method = VALUES(payment_method),
         cash_given = VALUES(cash_given),
         change_amount = VALUES(change_amount),
         qris_meta = VALUES(qris_meta),
         status = VALUES(status),
         created_at = VALUES(created_at),
         created_date = VALUES(created_date),
         paid_at = VALUES(paid_at)`,
      [
        order.id,
        Number(order.subtotal || 0),
        order.paymentMethod || "cash",
        order.paymentMethod === "cash" && order.cashGiven != null ? Number(order.cashGiven) : null,
        Number(order.change || 0),
        order.qrisMeta ? JSON.stringify(order.qrisMeta) : null,
        order.status || "paid",
        createdAt,
        createdDate,
        paidAt
      ]
    );

    await conn.execute("DELETE FROM order_items WHERE order_id = ?", [order.id]);
    for (const item of order.items || []) {
      await conn.execute(
        `INSERT INTO order_items (line_id, order_id, title, price, qty, line_total, sku, variant_title, product_handle, retur_status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           title = VALUES(title),
           price = VALUES(price),
           qty = VALUES(qty),
           line_total = VALUES(line_total),
           sku = VALUES(sku),
           variant_title = VALUES(variant_title),
           product_handle = VALUES(product_handle),
           retur_status = VALUES(retur_status),
           created_at = VALUES(created_at)`,
        [
          item.lineId,
          order.id,
          item.title,
          Number(item.price || 0),
          Number(item.qty || 0),
          Number(item.lineTotal || 0),
          item.sku || null,
          item.variantTitle || null,
          item.productHandle || null,
          item.returStatus || null,
          createdAt
        ]
      );
    }

    await conn.execute("DELETE FROM order_retur_history WHERE order_id = ?", [order.id]);
    for (const rh of order.returHistory || []) {
      await conn.execute(
        `INSERT INTO order_retur_history (order_id, line_id, title, price, qty, line_total, reason, retur_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          order.id,
          rh.lineId,
          rh.title,
          Number(rh.price || 0),
          Number(rh.qty || 0),
          Number(rh.lineTotal || 0),
          rh.reason || "",
          rh.returAt ? new Date(rh.returAt) : new Date()
        ]
      );
    }

    return { success: true, synced: 1, message: "Order berhasil disinkronkan." };
  } catch (err) {
    throw err;
  } finally {
    conn.release();
  }
}

async function syncAllOrdersToDatabase(app) {
  const orders = readOrders(app);
  const unSyncedOrders = orders.filter((o) => !o.synced);

  let apiSyncedCount = 0;
  let apiMessage = "";

  // 1. Sync to Web Hosting API
  if (unSyncedOrders.length > 0) {
    try {
      const transactionsPayload = unSyncedOrders.map((order) => {
        const saleDate = order.createdAt ? order.createdAt.split("T")[0] : new Date().toISOString().split("T")[0];
        const createdDateTime = order.createdAt ? order.createdAt.replace("T", " ").split(".")[0] : undefined;

        return {
          offline_id: order.id,
          tanggal_jual: saleDate,
          created_at: createdDateTime,
          idpelanggan: order.idpelanggan || 0,
          subtotal: order.subtotal || 0,
          diskon_jual: order.diskon || 0,
          metode_bayar: order.paymentMethod === "cash" ? "tunai" : (order.paymentMethod === "qris" || order.paymentMethod === "card" ? "card" : "hutang"),
          jumlah_uang: order.cashGiven != null ? order.cashGiven : (order.totalBayar || order.subtotal),
          items: (order.items || []).map((it) => ({
            id_produk: it.productId || it.id_produk || it.id,
            jumlah: it.qty || 1,
            harga_jual: it.price || 0
          }))
        };
      });

      const apiRes = await apiService.syncOffline(app, transactionsPayload);
      if (apiRes && apiRes.status === "success") {
        const results = apiRes.results || [];
        for (const res of results) {
          const target = orders.find((o) => o.id === res.offline_id || o.offline_id === res.offline_id);
          if (target) {
            target.synced = true;
            target.id = res.nofaktur || target.id;
            target.nofaktur = res.nofaktur;
            target.id_jual = res.jual_id;
            target.syncError = null;
          }
        }
        writeOrders(app, orders);
        apiSyncedCount = apiRes.synced || results.length;
        apiMessage = apiRes.message || `${apiSyncedCount} order berhasil disinkronisasi ke server web.`;
      }
    } catch (apiErr) {
      console.warn("[POS] Web API sync-offline error:", apiErr.message);
      apiMessage = `Gagal sinkron web: ${apiErr.message}`;
    }
  }

  // 2. Also mirror to direct MySQL if connected
  if (db.isConnected()) {
    try {
      const allOrders = getAllOrdersForSync(app);
      const pool = await db.getPool();
      const conn = await pool.getConnection();
      try {
        for (const order of allOrders) {
          const createdAt = new Date(order.createdAt || Date.now());
          const createdDate = createdAt.toISOString().split("T")[0];
          const paidAt = new Date(order.paidAt || order.createdAt || Date.now());

          await conn.execute(
            `INSERT INTO orders (id, subtotal, payment_method, cash_given, change_amount, qris_meta, status, created_at, created_date, paid_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
               subtotal = VALUES(subtotal),
               payment_method = VALUES(payment_method),
               cash_given = VALUES(cash_given),
               change_amount = VALUES(change_amount),
               qris_meta = VALUES(qris_meta),
               status = VALUES(status),
               created_at = VALUES(created_at),
               created_date = VALUES(created_date),
               paid_at = VALUES(paid_at)`,
            [
              order.id,
              Number(order.subtotal || 0),
              order.paymentMethod || "cash",
              order.paymentMethod === "cash" && order.cashGiven != null ? Number(order.cashGiven) : null,
              Number(order.change || 0),
              order.qrisMeta ? JSON.stringify(order.qrisMeta) : null,
              order.status || "paid",
              createdAt,
              createdDate,
              paidAt
            ]
          );

          await conn.execute("DELETE FROM order_items WHERE order_id = ?", [order.id]);
          for (const item of order.items || []) {
            await conn.execute(
              `INSERT INTO order_items (line_id, order_id, title, price, qty, line_total, sku, variant_title, product_handle, retur_status, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON DUPLICATE KEY UPDATE
                 title = VALUES(title),
                 price = VALUES(price),
                 qty = VALUES(qty),
                 line_total = VALUES(line_total),
                 sku = VALUES(sku),
                 variant_title = VALUES(variant_title),
                 product_handle = VALUES(product_handle),
                 retur_status = VALUES(retur_status),
                 created_at = VALUES(created_at)`,
              [
                item.lineId,
                order.id,
                item.title,
                Number(item.price || 0),
                Number(item.qty || 0),
                Number(item.lineTotal || 0),
                item.sku || null,
                item.variantTitle || null,
                item.productHandle || null,
                item.returStatus || null,
                createdAt
              ]
            );
          }
        }
      } finally {
        conn.release();
      }
    } catch (mysqlErr) {
      console.warn("[POS] Direct MySQL sync warning:", mysqlErr.message);
    }
  }

  if (unSyncedOrders.length === 0) {
    return { success: true, synced: 0, message: "Semua order sudah tersinkronisasi." };
  }

  return {
    success: apiSyncedCount > 0,
    synced: apiSyncedCount,
    message: apiMessage || `${apiSyncedCount} order tersinkronisasi.`
  };
}

async function clearAllOrders(app) {
  const dataDir = resolveDataDir(app);
  let deletedFilesCount = 0;

  if (fs.existsSync(dataDir)) {
    const files = fs.readdirSync(dataDir);
    for (const f of files) {
      if (f.startsWith("orders-") && f.endsWith(".json")) {
        try {
          fs.unlinkSync(path.join(dataDir, f));
          deletedFilesCount++;
        } catch {}
      }
      if (f.startsWith("transactions-") && f.endsWith(".json")) {
        try {
          fs.unlinkSync(path.join(dataDir, f));
          deletedFilesCount++;
        } catch {}
      }
      if (f === "offline-orders-queue.json") {
        try {
          fs.unlinkSync(path.join(dataDir, f));
          deletedFilesCount++;
        } catch {}
      }
    }
  }

  // Also truncate in local MySQL DB if connected
  try {
    const pool = await db.getPool();
    if (pool) {
      await pool.execute("DELETE FROM order_items");
      await pool.execute("DELETE FROM orders");
      try {
        await pool.execute("DELETE FROM transactions");
      } catch {}
    }
  } catch (err) {
    console.warn("[POS] Failed to clear DB orders:", err.message);
  }

  return {
    success: true,
    message: `Berhasil mengosongkan seluruh histori transaksi lokal (${deletedFilesCount} file dibersihkan).`
  };
}

module.exports = {
  getTodayOrders,
  createOrder,
  returOrderItem,
  getOrderById,
  getTodayOrdersSummary,
  getOrdersByDateRange,
  getAllOrdersForSync,
  syncOrderToDatabase,
  syncAllOrdersToDatabase,
  clearAllOrders
};
