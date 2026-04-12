import { useMemo, useState } from "react";
import PaymentModal from "./PaymentModal";
import ReturModal from "./ReturModal";

function formatRupiah(value) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0
  }).format(Number(value || 0));
}

function formatDate(value) {
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

const CART_PAGE_SIZE = 10;
const ORDER_PAGE_SIZE = 8;

export default function CustomOrder({ orders, summary, onRefresh }) {
  // -- Item form --
  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("");
  const [qty, setQty] = useState(1);

  // -- Cart --
  const [cart, setCart] = useState([]);
  const [cartSearch, setCartSearch] = useState("");
  const [cartPage, setCartPage] = useState(0);

  // -- Payment modal --
  const [showPayment, setShowPayment] = useState(false);

  // -- Retur modal --
  const [returTarget, setReturTarget] = useState(null);

  // -- Collapsible panels (default hidden) --
  const [showSummary, setShowSummary] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  // -- Order history search + paging --
  const [orderSearch, setOrderSearch] = useState("");
  const [orderPage, setOrderPage] = useState(0);

  // -- Status --
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  // -- Detail expanded order --
  const [expandedOrderId, setExpandedOrderId] = useState(null);

  const cartTotal = cart.reduce((s, item) => s + item.price * item.qty, 0);

  // -- Filtered + paged cart --
  const filteredCart = useMemo(() => {
    if (!cartSearch.trim()) return cart;
    const q = cartSearch.toLowerCase();
    return cart.filter((i) => i.title.toLowerCase().includes(q));
  }, [cart, cartSearch]);
  const cartTotalPages = Math.max(1, Math.ceil(filteredCart.length / CART_PAGE_SIZE));
  const pagedCart = filteredCart.slice(cartPage * CART_PAGE_SIZE, (cartPage + 1) * CART_PAGE_SIZE);

  // -- Filtered + paged orders --
  const filteredOrders = useMemo(() => {
    if (!orderSearch.trim()) return orders;
    const q = orderSearch.toLowerCase();
    return orders.filter(
      (o) =>
        o.id.toLowerCase().includes(q) ||
        o.paymentMethod.toLowerCase().includes(q) ||
        o.items.some((i) => i.title.toLowerCase().includes(q))
    );
  }, [orders, orderSearch]);
  const orderTotalPages = Math.max(1, Math.ceil(filteredOrders.length / ORDER_PAGE_SIZE));
  const pagedOrders = filteredOrders.slice(orderPage * ORDER_PAGE_SIZE, (orderPage + 1) * ORDER_PAGE_SIZE);

  function addToCart() {
    const p = Number(price);
    const q = Number(qty);
    if (!title.trim()) { setStatus("Judul barang wajib diisi."); return; }
    if (!Number.isFinite(p) || p <= 0) { setStatus("Harga harus lebih dari 0."); return; }
    if (!Number.isFinite(q) || q < 1) { setStatus("Qty minimal 1."); return; }

    setCart((prev) => [
      ...prev,
      { id: Date.now(), title: title.trim(), price: p, qty: q }
    ]);
    setTitle("");
    setPrice("");
    setQty(1);
    setStatus("");
  }

  function removeFromCart(id) {
    setCart((prev) => prev.filter((i) => i.id !== id));
  }

  function updateQty(id, delta) {
    setCart((prev) =>
      prev.map((i) => {
        if (i.id !== id) return i;
        const newQty = Math.max(1, i.qty + delta);
        return { ...i, qty: newQty };
      })
    );
  }

  async function handlePaymentDone(method, cashGiven) {
    try {
      setLoading(true);
      setStatus("Memproses pembayaran...");
      const result = await window.posApi.createOrder({
        items: cart.map(({ title, price, qty }) => ({ title, price, qty })),
        paymentMethod: method,
        cashGiven: method === "cash" ? Number(cashGiven) : null
      });
      setCart([]);
      setCartPage(0);
      setShowPayment(false);
      const printMsg = result.printResult?.message || "";
      setStatus(`Pembayaran berhasil. ${printMsg}`);
      onRefresh();
    } catch (err) {
      setStatus(`Gagal: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleRetur(orderId, lineId, reason) {
    try {
      setLoading(true);
      setStatus("Memproses retur...");
      await window.posApi.returOrderItem({ orderId, lineId, reason });
      setReturTarget(null);
      setStatus("Retur berhasil diproses.");
      onRefresh();
    } catch (err) {
      setStatus(`Retur gagal: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {/* ───── Tambah Item (compact, full width on top) ───── */}
      <section className="panel form-panel form-panel-inline">
        <h2>Tambah Item</h2>
        <div className="form-inline-row">
          <div className="form-field">
            <label htmlFor="itemTitle">Nama Barang</label>
            <input id="itemTitle" type="text" placeholder="Contoh: Kopi Susu"
              value={title} onChange={(e) => setTitle(e.target.value)} disabled={loading} />
          </div>
          <div className="form-field">
            <label htmlFor="itemPrice">Harga (Rp)</label>
            <input id="itemPrice" type="number" min="0" step="100" placeholder="15000"
              value={price} onChange={(e) => setPrice(e.target.value)} disabled={loading} />
          </div>
          <div className="form-field form-field-qty">
            <label htmlFor="itemQty">Qty</label>
            <div className="qty-row">
              <button className="btn btn-qty" disabled={loading || qty <= 1}
                onClick={() => setQty((q) => Math.max(1, q - 1))}>−</button>
              <input id="itemQty" type="number" min="1" className="qty-input"
                value={qty} onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))} disabled={loading} />
              <button className="btn btn-qty" disabled={loading}
                onClick={() => setQty((q) => q + 1)}>+</button>
            </div>
          </div>
          <div className="form-field form-field-action">
            <label>&nbsp;</label>
            <button className="btn btn-save" onClick={addToCart} disabled={loading}>Save</button>
          </div>
        </div>
        {status && <div className="status">{status}</div>}
      </section>

      {/* ───── Keranjang Belanja (full width, dominant) ───── */}
      <section className="panel cart-panel cart-panel-full">
        <div className="section-header">
          <h2>Keranjang Belanja ({cart.length} item)</h2>
          <input className="search-input" type="text" placeholder="Cari di keranjang..."
            value={cartSearch} onChange={(e) => { setCartSearch(e.target.value); setCartPage(0); }} />
        </div>
        <div className="table-wrap cart-table-wrap">
          <table>
            <thead>
              <tr><th>Barang</th><th>Harga</th><th>Qty</th><th>Subtotal</th><th></th></tr>
            </thead>
            <tbody>
              {pagedCart.length === 0 && (
                <tr><td colSpan="5" className="empty-cell">{cart.length === 0 ? "Keranjang kosong." : "Tidak ditemukan."}</td></tr>
              )}
              {pagedCart.map((item) => (
                <tr key={item.id}>
                  <td>{item.title}</td>
                  <td>{formatRupiah(item.price)}</td>
                  <td>
                    <div className="qty-row-sm">
                      <button className="btn-qty-sm" onClick={() => updateQty(item.id, -1)}>−</button>
                      <span>{item.qty}</span>
                      <button className="btn-qty-sm" onClick={() => updateQty(item.id, 1)}>+</button>
                    </div>
                  </td>
                  <td className="txt-in">{formatRupiah(item.price * item.qty)}</td>
                  <td><button className="btn-remove" onClick={() => removeFromCart(item.id)}>×</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Cart paging */}
        {filteredCart.length > CART_PAGE_SIZE && (
          <div className="paging">
            <button disabled={cartPage <= 0} onClick={() => setCartPage((p) => p - 1)}>← Prev</button>
            <span>Hal {cartPage + 1} / {cartTotalPages}</span>
            <button disabled={cartPage >= cartTotalPages - 1} onClick={() => setCartPage((p) => p + 1)}>Next →</button>
          </div>
        )}

        <div className="cart-footer">
          <div className="cart-total">Total: <strong>{formatRupiah(cartTotal)}</strong></div>
          <button className="btn btn-bayar" disabled={loading || cart.length === 0}
            onClick={() => setShowPayment(true)}>
            Bayar
          </button>
        </div>
      </section>

      {/* ───── Summary (collapsible, default hidden) ───── */}
      <section className="panel collapsible-panel">
        <button className="collapse-toggle" onClick={() => setShowSummary((v) => !v)}>
          <h2>Summary Order Hari Ini</h2>
          <span className="chevron">{showSummary ? "▲" : "▼"}</span>
        </button>
        {showSummary && (
          <div className="summary-grid summary-grid-5">
            <article><h3>Total Penjualan</h3><p>{formatRupiah(summary.totalSales)}</p></article>
            <article><h3>Jumlah Order</h3><p>{summary.totalOrders}</p></article>
            <article><h3>Cash</h3><p>{formatRupiah(summary.totalCash)}</p></article>
            <article><h3>QRIS</h3><p>{formatRupiah(summary.totalQris)}</p></article>
            <article><h3>Retur</h3><p className="txt-out">{formatRupiah(summary.totalReturned)}</p></article>
          </div>
        )}
      </section>

      {/* ───── Riwayat Order (collapsible, default hidden) ───── */}
      <section className="panel collapsible-panel">
        <button className="collapse-toggle" onClick={() => setShowHistory((v) => !v)}>
          <h2>Riwayat Order Hari Ini ({orders.length})</h2>
          <span className="chevron">{showHistory ? "▲" : "▼"}</span>
        </button>
        {showHistory && (
          <>
            <input className="search-input search-full" type="text"
              placeholder="Cari order (ID, barang, metode)..."
              value={orderSearch} onChange={(e) => { setOrderSearch(e.target.value); setOrderPage(0); }} />

            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Waktu</th><th>Order ID</th><th>Items</th><th>Metode</th><th>Total</th><th>Status</th><th></th></tr>
                </thead>
                <tbody>
                  {pagedOrders.length === 0 && (
                    <tr><td colSpan="7" className="empty-cell">{orders.length === 0 ? "Belum ada order hari ini." : "Tidak ditemukan."}</td></tr>
                  )}
                  {pagedOrders.map((ord) => (
                    <>
                      <tr key={ord.id} className="order-row" onClick={() => setExpandedOrderId(expandedOrderId === ord.id ? null : ord.id)}>
                        <td>{formatDate(ord.createdAt)}</td>
                        <td className="mono">{ord.id}</td>
                        <td>{ord.items.length} item</td>
                        <td>{ord.paymentMethod === "cash" ? "Cash" : "QRIS"}</td>
                        <td className="txt-in">{formatRupiah(ord.subtotal)}</td>
                        <td>
                          <span className={`badge badge-${ord.status}`}>
                            {ord.status === "paid" ? "Lunas" : ord.status === "partial-return" ? "Partial Retur" : "Full Retur"}
                          </span>
                        </td>
                        <td><button className="btn-expand">{expandedOrderId === ord.id ? "▲" : "▼"}</button></td>
                      </tr>
                      {expandedOrderId === ord.id && (
                        <tr key={`${ord.id}-detail`}>
                          <td colSpan="7" className="order-detail-cell">
                            <table className="inner-table">
                              <thead><tr><th>Barang</th><th>Harga</th><th>Qty</th><th>Subtotal</th><th>Status</th><th></th></tr></thead>
                              <tbody>
                                {ord.items.map((ln) => (
                                  <tr key={ln.lineId} className={ln.returStatus === "returned" ? "row-returned" : ""}>
                                    <td>{ln.title}</td>
                                    <td>{formatRupiah(ln.price)}</td>
                                    <td>{ln.qty}</td>
                                    <td>{formatRupiah(ln.lineTotal)}</td>
                                    <td>{ln.returStatus === "returned" ? <span className="badge badge-retur">Diretur</span> : "OK"}</td>
                                    <td>
                                      {ln.returStatus !== "returned" && (
                                        <button className="btn btn-retur-sm"
                                          onClick={(e) => { e.stopPropagation(); setReturTarget({ order: ord, line: ln }); }}>
                                          Retur
                                        </button>
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                            {ord.returHistory.length > 0 && (
                              <div className="retur-history">
                                <strong>Retur History:</strong>
                                <ul>
                                  {ord.returHistory.map((rh, i) => (
                                    <li key={i}>{formatDate(rh.returAt)} — {rh.title} ({rh.qty}x {formatRupiah(rh.price)}) {rh.reason ? `— ${rh.reason}` : ""}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Order paging */}
            {filteredOrders.length > ORDER_PAGE_SIZE && (
              <div className="paging">
                <button disabled={orderPage <= 0} onClick={() => setOrderPage((p) => p - 1)}>← Prev</button>
                <span>Hal {orderPage + 1} / {orderTotalPages}</span>
                <button disabled={orderPage >= orderTotalPages - 1} onClick={() => setOrderPage((p) => p + 1)}>Next →</button>
              </div>
            )}
          </>
        )}
      </section>

      {/* Modals */}
      {showPayment && (
        <PaymentModal
          total={cartTotal}
          loading={loading}
          onPay={handlePaymentDone}
          onClose={() => setShowPayment(false)}
        />
      )}
      {returTarget && (
        <ReturModal
          order={returTarget.order}
          line={returTarget.line}
          loading={loading}
          onRetur={handleRetur}
          onClose={() => setReturTarget(null)}
        />
      )}
    </>
  );
}
