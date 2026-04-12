const fs = require("fs");
const path = require("path");

function getDateKey() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function getDataDir(app) {
  const dir = path.join(app.getPath("userData"), "data");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function getOrdersFilePath(app) {
  return path.join(getDataDir(app), `orders-${getDateKey()}.json`);
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

function getTodayOrders(app) {
  return readOrders(app).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function createOrder(app, { items, paymentMethod, cashGiven }) {
  const orders = readOrders(app);
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
      returStatus: null // null | "returned"
    })),
    subtotal,
    paymentMethod, // "cash" | "qris"
    cashGiven: paymentMethod === "cash" ? Number(cashGiven) : null,
    change: paymentMethod === "cash" ? Number(cashGiven) - subtotal : 0,
    status: "paid", // "paid" | "partial-return"
    returHistory: [],
    createdAt: now.toISOString(),
    paidAt: now.toISOString()
  };

  orders.push(order);
  writeOrders(app, orders);
  return order;
}

function returOrderItem(app, { orderId, lineId, reason }) {
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

  // Recalculate subtotal from non-returned items
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

function getOrderById(app, orderId) {
  return readOrders(app).find((o) => o.id === orderId) || null;
}

function getTodayOrdersSummary(app) {
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

module.exports = {
  getTodayOrders,
  createOrder,
  returOrderItem,
  getOrderById,
  getTodayOrdersSummary
};
