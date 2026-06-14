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
    return await readOrdersFromDB();
  }
  return readOrders(app).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function createOrder(app, { items, paymentMethod, cashGiven, qrisMeta }) {
  const now = new Date();

  const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
  const order = {
    id: `ORD-${now.getTime()}`,
    items: items.map((item, idx) => ({
      lineId: `LN-${now.getTime()}-${idx}`,
      title: item.title,
      price: Number(item.price),
      qty: Number(item.qty),
      lineTotal: Number(item.price) * Number(item.qty),
      sku: item.sku || null,
      variantTitle: item.variantTitle || null,
      productHandle: item.productHandle || null,
      returStatus: null
    })),
    subtotal,
    paymentMethod,
    cashGiven: paymentMethod === "cash" ? Number(cashGiven) : null,
    change: paymentMethod === "cash" ? Number(cashGiven) - subtotal : 0,
    qrisMeta: paymentMethod === "qris" ? (qrisMeta || null) : null,
    status: "paid",
    returHistory: [],
    createdAt: now.toISOString(),
    paidAt: now.toISOString()
  };

  if (db.isConnected()) {
    writeOrderToDB(order).catch((err) => {
      console.error("Async DB write order failed:", err);
    });
  } else {
    const orders = readOrders(app);
    orders.push(order);
    writeOrders(app, orders);
  }

  return order;
}

function returOrderItem(app, { orderId, lineId, reason }) {
  if (db.isConnected()) {
    return returOrderItemDB(orderId, lineId, reason);
  }

  const orders = readOrders(app);
  const order = orders.find((o) => o.id === orderId);
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

async function returOrderItemDB(orderId, lineId, reason) {
  try {
    throw new Error("Retur order via database belum diimplementasi. Gunakan JSON file untuk saat ini.");
  } catch (err) {
    throw err;
  }
}

async function getOrderById(app, orderId) {
  if (db.isConnected()) {
    return getOrderByIdDB(orderId);
  }
  return readOrders(app).find((o) => o.id === orderId) || null;
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
    return await getTodayOrdersSummaryDB();
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
    return getOrdersByDateRangeDB(from, to);
  }
  return getOrdersByDateRangeJSON(app, from, to);
}

module.exports = {
  getTodayOrders,
  createOrder,
  returOrderItem,
  getOrderById,
  getTodayOrdersSummary,
  getOrdersByDateRange
};
