import { Fragment, useEffect, useMemo, useRef, useState } from "react";
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

export default function CustomOrder({ orders, summary, onRefresh, canCreateOrder = true, canRetur = true }) {
  const [catalog, setCatalog] = useState({
    products: [],
    categories: [],
    sourceFilesCount: 0,
    loadedAt: null
  });
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogSearch, setCatalogSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("all");
  const [selectedProductId, setSelectedProductId] = useState(null);
  const [manualPrice, setManualPrice] = useState("");
  const [manualQty, setManualQty] = useState(1);

  const [cart, setCart] = useState([]);
  const [cartSearch, setCartSearch] = useState("");
  const [cartPage, setCartPage] = useState(0);

  const [showPayment, setShowPayment] = useState(false);
  const [returTarget, setReturTarget] = useState(null);

  const [showSummary, setShowSummary] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const [orderSearch, setOrderSearch] = useState("");
  const [orderPage, setOrderPage] = useState(0);

  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [expandedOrderId, setExpandedOrderId] = useState(null);

  const catalogSearchRef = useRef(null);
  const cartSearchRef = useRef(null);

  useEffect(() => {
    loadCatalog(false).catch(() => {});
  }, []);

  async function loadCatalog(forceReload) {
    try {
      setCatalogLoading(true);
      setStatus(forceReload ? "Memuat ulang katalog CSV..." : "Memuat katalog produk...");

      const data = forceReload
        ? await window.posApi.reloadCatalog()
        : await window.posApi.getCatalog();

      setCatalog(data);
      if (data.products.length > 0 && !selectedProductId) {
        setSelectedProductId(data.products[0].id);
      }
      setStatus(
        `Katalog siap. ${data.products.length} produk dari ${data.sourceFilesCount} file CSV.`
      );
    } catch (err) {
      setStatus(`Gagal memuat katalog: ${err.message}`);
    } finally {
      setCatalogLoading(false);
    }
  }

  const selectedProduct = useMemo(() => {
    if (!selectedProductId) return null;
    return catalog.products.find((p) => p.id === selectedProductId) || null;
  }, [catalog.products, selectedProductId]);

  const filteredProducts = useMemo(() => {
    const q = catalogSearch.trim().toLowerCase();

    return catalog.products.filter((p) => {
      const categoryMatch = activeCategory === "all" || p.category === activeCategory;
      if (!categoryMatch) return false;
      if (!q) return true;

      const skuMatch = p.variants.some((v) => (v.sku || "").toLowerCase().includes(q));
      return (
        p.title.toLowerCase().includes(q) ||
        (p.vendor || "").toLowerCase().includes(q) ||
        (p.category || "").toLowerCase().includes(q) ||
        skuMatch
      );
    });
  }, [catalog.products, activeCategory, catalogSearch]);

  useEffect(() => {
    const q = catalogSearch.trim();
    if (!q) return;
    if (filteredProducts.length > 0) {
      setSelectedProductId(filteredProducts[0].id);
    }
  }, [catalogSearch, filteredProducts]);

  const isCustomFallbackMode = filteredProducts.length === 0 && Boolean(catalogSearch.trim());

  const cartTotal = cart.reduce((s, item) => s + item.price * item.qty, 0);

  const filteredCart = useMemo(() => {
    if (!cartSearch.trim()) return cart;
    const q = cartSearch.toLowerCase();
    return cart.filter((i) => i.title.toLowerCase().includes(q) || (i.sku || "").toLowerCase().includes(q));
  }, [cart, cartSearch]);

  const cartTotalPages = Math.max(1, Math.ceil(filteredCart.length / CART_PAGE_SIZE));
  const pagedCart = filteredCart.slice(cartPage * CART_PAGE_SIZE, (cartPage + 1) * CART_PAGE_SIZE);

  const filteredOrders = useMemo(() => {
    if (!orderSearch.trim()) return orders;
    const q = orderSearch.toLowerCase();

    return orders.filter(
      (o) =>
        o.id.toLowerCase().includes(q) ||
        o.paymentMethod.toLowerCase().includes(q) ||
        o.items.some((i) => i.title.toLowerCase().includes(q) || (i.sku || "").toLowerCase().includes(q))
    );
  }, [orders, orderSearch]);

  const orderTotalPages = Math.max(1, Math.ceil(filteredOrders.length / ORDER_PAGE_SIZE));
  const pagedOrders = filteredOrders.slice(orderPage * ORDER_PAGE_SIZE, (orderPage + 1) * ORDER_PAGE_SIZE);

  function addVariantToCart(product, variant) {
    if (!canCreateOrder) {
      setStatus("Akun ini tidak memiliki akses membuat order.");
      return;
    }

    setCart((prev) => [
      ...prev,
      {
        id: Date.now() + Math.random(),
        title: `${product.title} - ${variant.title}`,
        price: Number(variant.price) || 0,
        qty: 1,
        sku: variant.sku || null,
        variantTitle: variant.title || null,
        productHandle: product.handle || null
      }
    ]);
    setStatus("");
  }

  function addManualFallbackToCart() {
    if (!canCreateOrder) {
      setStatus("Akun ini tidak memiliki akses membuat order.");
      return;
    }

    const name = catalogSearch.trim();
    const p = Number(manualPrice);
    const q = Number(manualQty);

    if (!name) {
      setStatus("Isi nama produk di kolom pencarian terlebih dahulu.");
      return;
    }
    if (!Number.isFinite(p) || p <= 0) {
      setStatus("Harga manual harus lebih dari 0.");
      return;
    }
    if (!Number.isFinite(q) || q < 1) {
      setStatus("Qty manual minimal 1.");
      return;
    }

    setCart((prev) => [
      ...prev,
      {
        id: Date.now() + Math.random(),
        title: name,
        price: p,
        qty: q,
        sku: null,
        variantTitle: null,
        productHandle: null
      }
    ]);

    setManualPrice("");
    setManualQty(1);
    setStatus("Produk custom ditambahkan ke keranjang.");
  }

  function removeFromCart(id) {
    setCart((prev) => prev.filter((i) => i.id !== id));
  }

  function updateQty(id, delta) {
    setCart((prev) =>
      prev.map((i) => {
        if (i.id !== id) return i;
        return { ...i, qty: Math.max(1, i.qty + delta) };
      })
    );
  }

  async function handlePaymentDone(method, cashGiven, qrisMeta = null) {
    if (!canCreateOrder) {
      setStatus("Akun ini tidak memiliki akses membuat order.");
      return;
    }

    try {
      setLoading(true);
      setStatus("Memproses pembayaran...");

      const result = await window.posApi.createOrder({
        items: cart.map(({ title, price, qty, sku, variantTitle, productHandle }) => ({
          title,
          price,
          qty,
          sku,
          variantTitle,
          productHandle
        })),
        paymentMethod: method,
        cashGiven: method === "cash" ? Number(cashGiven) : null,
        qrisMeta: method === "qris" ? qrisMeta : null
      });

      setCart([]);
      setCartPage(0);
      setShowPayment(false);
      setStatus(`Pembayaran berhasil. ${result.printResult?.message || ""}`);
      onRefresh();
    } catch (err) {
      setStatus(`Gagal: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleRetur(orderId, lineId, reason) {
    if (!canRetur) {
      setStatus("Akun ini tidak memiliki akses retur order.");
      return;
    }

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

  useEffect(() => {
    function onKeydown(e) {
      const targetTag = String(e.target?.tagName || "").toLowerCase();
      const isTyping = targetTag === "input" || targetTag === "textarea" || targetTag === "select" || e.target?.isContentEditable;
      const key = e.key.toLowerCase();

      if ((e.ctrlKey || e.metaKey) && key === "k") {
        e.preventDefault();
        catalogSearchRef.current?.focus();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && key === "l") {
        e.preventDefault();
        cartSearchRef.current?.focus();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && key === "r") {
        e.preventDefault();
        loadCatalog(true).catch(() => {});
        return;
      }

      if ((e.ctrlKey || e.metaKey) && key === "b") {
        e.preventDefault();
        if (canCreateOrder && cart.length > 0 && !loading) {
          setShowPayment(true);
        }
        return;
      }

      if ((e.altKey && key === "s") || (e.altKey && key === "h")) {
        e.preventDefault();
        if (key === "s") setShowSummary((v) => !v);
        if (key === "h") setShowHistory((v) => !v);
        return;
      }

      if (e.key === "Enter" && document.activeElement === catalogSearchRef.current) {
        e.preventDefault();
        if (!canCreateOrder) return;

        if (isCustomFallbackMode) {
          addManualFallbackToCart();
          return;
        }

        if (selectedProduct?.variants?.length > 0) {
          addVariantToCart(selectedProduct, selectedProduct.variants[0]);
        }
        return;
      }

      if (isTyping && !(e.ctrlKey || e.metaKey)) return;

      if ((e.ctrlKey || e.metaKey) && key === "backspace") {
        e.preventDefault();
        if (cart.length > 0) {
          const last = cart[cart.length - 1];
          removeFromCart(last.id);
        }
      }

      if ((e.ctrlKey || e.metaKey) && key === "arrowup") {
        e.preventDefault();
        if (cart.length > 0) {
          const last = cart[cart.length - 1];
          updateQty(last.id, 1);
        }
      }

      if ((e.ctrlKey || e.metaKey) && key === "arrowdown") {
        e.preventDefault();
        if (cart.length > 0) {
          const last = cart[cart.length - 1];
          updateQty(last.id, -1);
        }
      }
    }

    window.addEventListener("keydown", onKeydown);
    return () => window.removeEventListener("keydown", onKeydown);
  }, [cart, loading, canCreateOrder, isCustomFallbackMode, selectedProduct, manualPrice, manualQty, catalogSearch]);

  return (
    <>
      <section className="panel order-shortcut-panel">
        <h3>Shortcut Order</h3>
        <p className="small-text">
          Ctrl+K: Cari produk | Ctrl+L: Cari keranjang | Ctrl+B: Bayar | Ctrl+R: Reload CSV | Ctrl+Backspace: Hapus item terakhir | Ctrl+ArrowUp/ArrowDown: Qty item terakhir | Alt+S: Summary | Alt+H: Riwayat
        </p>
      </section>

      <div className="order-main-grid">
      <section className="panel form-panel form-panel-inline order-catalog-panel">
        <div className="catalog-header-row">
          <div>
            <h2>Katalog Produk (CSV Shopify)</h2>
            <p className="small-text catalog-meta-text">
              {catalog.sourceFilesCount || 0} file CSV • {catalog.products.length || 0} produk
            </p>
          </div>
          <button className="btn btn-secondary" onClick={() => loadCatalog(true)} disabled={catalogLoading}>
            {catalogLoading ? "Memuat..." : "Reload CSV"}
          </button>
        </div>

        <div className="catalog-toolbar">
          <input
            ref={catalogSearchRef}
            className="search-input catalog-search"
            type="text"
            placeholder="Cari produk / SKU / kategori..."
            value={catalogSearch}
            onChange={(e) => {
              setCatalogSearch(e.target.value);
            }}
            disabled={catalogLoading}
          />
          <div className="category-pills">
            <button
              className={`category-pill ${activeCategory === "all" ? "active" : ""}`}
              onClick={() => setActiveCategory("all")}
              disabled={catalogLoading}
            >
              Semua
            </button>
            {catalog.categories.map((cat) => (
              <button
                key={cat}
                className={`category-pill ${activeCategory === cat ? "active" : ""}`}
                onClick={() => setActiveCategory(cat)}
                disabled={catalogLoading}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        <div className="catalog-layout">
          <div className="catalog-products-list">
            {filteredProducts.length === 0 && (
              <div className="manual-fallback-box">
                <div className="empty-cell">Tidak ada produk pada filter saat ini.</div>
              </div>
            )}
            {filteredProducts.map((p) => (
              <button
                key={p.id}
                className={`product-card ${selectedProductId === p.id ? "active" : ""}`}
                onClick={() => setSelectedProductId(p.id)}
              >
                <div className="product-card-title">{p.title}</div>
                <div className="product-card-meta">
                  <span>{p.category}</span>
                  <span>{p.variants.length} varian</span>
                </div>
                <div className="product-card-price">
                  mulai {formatRupiah(Math.min(...p.variants.map((v) => v.price || 0)))}
                </div>
              </button>
            ))}
          </div>

          <div className="catalog-variant-panel">
            {isCustomFallbackMode && (
              <div className="custom-order-panel">
                <h3 className="catalog-product-title">Custom Order</h3>
                <p className="small-text custom-order-label">
                  Produk tidak ditemukan, tambah manual untuk: <strong>{catalogSearch.trim()}</strong>
                </p>
                <div className="custom-order-form">
                  <label htmlFor="customPrice">Harga Custom</label>
                  <input
                    id="customPrice"
                    type="number"
                    min="0"
                    step="100"
                    placeholder="Contoh: 15000"
                    value={manualPrice}
                    onChange={(e) => setManualPrice(e.target.value)}
                  />

                  <label htmlFor="customQty">Qty</label>
                  <input
                    id="customQty"
                    type="number"
                    min="1"
                    placeholder="1"
                    value={manualQty}
                    onChange={(e) => setManualQty(Math.max(1, Number(e.target.value) || 1))}
                  />

                  <button
                    className="btn btn-save custom-order-add-btn"
                    onClick={addManualFallbackToCart}
                    disabled={!canCreateOrder}
                  >
                    + Tambah ke Keranjang
                  </button>
                </div>
              </div>
            )}

            {!isCustomFallbackMode && !selectedProduct && (
              <div className="empty-cell">Pilih produk untuk menampilkan varian.</div>
            )}
            {!isCustomFallbackMode && selectedProduct && (
              <>
                <h3 className="catalog-product-title">{selectedProduct.title}</h3>
                <p className="small-text">Kategori: {selectedProduct.category}</p>
                <div className="variant-list">
                  {selectedProduct.variants.map((variant) => (
                    <div key={`${selectedProduct.id}-${variant.id}`} className="variant-row">
                      <div>
                        <div className="variant-title">{variant.title}</div>
                        <div className="variant-subtext">
                          {variant.sku ? `SKU: ${variant.sku}` : "Tanpa SKU"}
                        </div>
                      </div>
                      <div className="variant-actions">
                        <strong>{formatRupiah(variant.price)}</strong>
                        <button
                          className="btn btn-save variant-add-btn"
                          onClick={() => addVariantToCart(selectedProduct, variant)}
                          disabled={loading || !canCreateOrder}
                        >
                          + Keranjang
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {status && <div className="status">{status}</div>}
      </section>

      <section className="panel cart-panel cart-panel-full order-cart-panel">
        <div className="section-header">
          <h2>Keranjang Belanja ({cart.length} item)</h2>
          <input
            ref={cartSearchRef}
            className="search-input"
            type="text"
            placeholder="Cari di keranjang..."
            value={cartSearch}
            onChange={(e) => {
              setCartSearch(e.target.value);
              setCartPage(0);
            }}
          />
        </div>

        <div className="table-wrap cart-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Barang</th>
                <th>SKU</th>
                <th>Harga</th>
                <th>Qty</th>
                <th>Subtotal</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pagedCart.length === 0 && (
                <tr>
                  <td colSpan="6" className="empty-cell">
                    {cart.length === 0 ? "Keranjang kosong." : "Tidak ditemukan."}
                  </td>
                </tr>
              )}
              {pagedCart.map((item) => (
                <tr key={item.id}>
                  <td>{item.title}</td>
                  <td className="mono">{item.sku || "-"}</td>
                  <td>{formatRupiah(item.price)}</td>
                  <td>
                    <div className="qty-row-sm">
                      <button className="btn-qty-sm" onClick={() => updateQty(item.id, -1)}>
                        −
                      </button>
                      <span>{item.qty}</span>
                      <button className="btn-qty-sm" onClick={() => updateQty(item.id, 1)}>
                        +
                      </button>
                    </div>
                  </td>
                  <td className="txt-in">{formatRupiah(item.price * item.qty)}</td>
                  <td>
                    <button className="btn-remove" onClick={() => removeFromCart(item.id)}>
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {filteredCart.length > CART_PAGE_SIZE && (
          <div className="paging">
            <button disabled={cartPage <= 0} onClick={() => setCartPage((p) => p - 1)}>
              ← Prev
            </button>
            <span>
              Hal {cartPage + 1} / {cartTotalPages}
            </span>
            <button disabled={cartPage >= cartTotalPages - 1} onClick={() => setCartPage((p) => p + 1)}>
              Next →
            </button>
          </div>
        )}

        <div className="cart-footer">
          <div className="cart-total">
            Total: <strong>{formatRupiah(cartTotal)}</strong>
          </div>
          <button
            className="btn btn-bayar"
            disabled={loading || cart.length === 0 || !canCreateOrder}
            onClick={() => setShowPayment(true)}
          >
            Bayar
          </button>
        </div>
      </section>
      </div>

      <section className="panel collapsible-panel">
        <button className="collapse-toggle" onClick={() => setShowSummary((v) => !v)}>
          <h2>Summary Order Hari Ini</h2>
          <span className="chevron">{showSummary ? "▲" : "▼"}</span>
        </button>
        {showSummary && (
          <div className="summary-grid summary-grid-5">
            <article>
              <h3>Total Penjualan</h3>
              <p>{formatRupiah(summary.totalSales)}</p>
            </article>
            <article>
              <h3>Jumlah Order</h3>
              <p>{summary.totalOrders}</p>
            </article>
            <article>
              <h3>Cash</h3>
              <p>{formatRupiah(summary.totalCash)}</p>
            </article>
            <article>
              <h3>QRIS</h3>
              <p>{formatRupiah(summary.totalQris)}</p>
            </article>
            <article>
              <h3>Retur</h3>
              <p className="txt-out">{formatRupiah(summary.totalReturned)}</p>
            </article>
          </div>
        )}
      </section>

      <section className="panel collapsible-panel">
        <button className="collapse-toggle" onClick={() => setShowHistory((v) => !v)}>
          <h2>Riwayat Order Hari Ini ({orders.length})</h2>
          <span className="chevron">{showHistory ? "▲" : "▼"}</span>
        </button>
        {showHistory && (
          <>
            <input
              className="search-input search-full"
              type="text"
              placeholder="Cari order (ID, barang, metode)..."
              value={orderSearch}
              onChange={(e) => {
                setOrderSearch(e.target.value);
                setOrderPage(0);
              }}
            />

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Waktu</th>
                    <th>Order ID</th>
                    <th>Items</th>
                    <th>Metode</th>
                    <th>Total</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {pagedOrders.length === 0 && (
                    <tr>
                      <td colSpan="7" className="empty-cell">
                        {orders.length === 0 ? "Belum ada order hari ini." : "Tidak ditemukan."}
                      </td>
                    </tr>
                  )}
                  {pagedOrders.map((ord) => (
                    <Fragment key={ord.id}>
                      <tr
                        className="order-row"
                        onClick={() => setExpandedOrderId(expandedOrderId === ord.id ? null : ord.id)}
                      >
                        <td>{formatDate(ord.createdAt)}</td>
                        <td className="mono">{ord.id}</td>
                        <td>{ord.items.length} item</td>
                        <td>{ord.paymentMethod === "cash" ? "Cash" : "QRIS"}</td>
                        <td className="txt-in">{formatRupiah(ord.subtotal)}</td>
                        <td>
                          <span className={`badge badge-${ord.status}`}>
                            {ord.status === "paid"
                              ? "Lunas"
                              : ord.status === "partial-return"
                                ? "Partial Retur"
                                : "Full Retur"}
                          </span>
                        </td>
                        <td>
                          <button className="btn-expand">{expandedOrderId === ord.id ? "▲" : "▼"}</button>
                        </td>
                      </tr>
                      {expandedOrderId === ord.id && (
                        <tr>
                          <td colSpan="7" className="order-detail-cell">
                            <table className="inner-table">
                              <thead>
                                <tr>
                                  <th>Barang</th>
                                  <th>Harga</th>
                                  <th>Qty</th>
                                  <th>Subtotal</th>
                                  <th>Status</th>
                                  <th></th>
                                </tr>
                              </thead>
                              <tbody>
                                {ord.items.map((ln) => (
                                  <tr key={ln.lineId} className={ln.returStatus === "returned" ? "row-returned" : ""}>
                                    <td>{ln.title}</td>
                                    <td>{formatRupiah(ln.price)}</td>
                                    <td>{ln.qty}</td>
                                    <td>{formatRupiah(ln.lineTotal)}</td>
                                    <td>
                                      {ln.returStatus === "returned" ? (
                                        <span className="badge badge-retur">Diretur</span>
                                      ) : (
                                        "OK"
                                      )}
                                    </td>
                                    <td>
                                      {ln.returStatus !== "returned" && (
                                        <button
                                          className="btn btn-retur-sm"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setReturTarget({ order: ord, line: ln });
                                          }}
                                          disabled={!canRetur}
                                        >
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
                                    <li key={i}>
                                      {formatDate(rh.returAt)} - {rh.title} ({rh.qty}x {formatRupiah(rh.price)})
                                      {rh.reason ? ` - ${rh.reason}` : ""}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>

            {filteredOrders.length > ORDER_PAGE_SIZE && (
              <div className="paging">
                <button disabled={orderPage <= 0} onClick={() => setOrderPage((p) => p - 1)}>
                  ← Prev
                </button>
                <span>
                  Hal {orderPage + 1} / {orderTotalPages}
                </span>
                <button disabled={orderPage >= orderTotalPages - 1} onClick={() => setOrderPage((p) => p + 1)}>
                  Next →
                </button>
              </div>
            )}
          </>
        )}
      </section>

      {showPayment && canCreateOrder && (
        <PaymentModal
          total={cartTotal}
          loading={loading}
          onPay={handlePaymentDone}
          onClose={() => setShowPayment(false)}
        />
      )}

      {returTarget && canRetur && (
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
