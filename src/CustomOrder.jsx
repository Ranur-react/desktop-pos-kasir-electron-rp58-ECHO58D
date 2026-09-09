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

function getDefaultAllHistoryFrom() {
  const date = new Date();
  date.setDate(date.getDate() - 365);
  return date.toISOString().split("T")[0];
}

const CART_PAGE_SIZE = 10;
const ORDER_PAGE_SIZE = 8;

export default function CustomOrder({ orders, summary, onRefresh, canCreateOrder = true, canRetur = true, compactMode = false }) {
  const [catalogSource, setCatalogSource] = useState("api"); // "api" | "csv" | "manual"
  const [catalog, setCatalog] = useState({
    products: [],
    categories: [],
    sourceFilesCount: 0,
    loadedAt: null,
    source: "online",
    warning: null
  });
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogSearch, setCatalogSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("all");
  const [selectedProductId, setSelectedProductId] = useState(null);
  const [manualPrice, setManualPrice] = useState("");
  const [manualQty, setManualQty] = useState(1);
  const [viewMode, setViewMode] = useState("grid"); // "grid" | "list"

  // Cart state
  const [cart, setCart] = useState([]);
  const [cartSearch, setCartSearch] = useState("");
  const [cartPage, setCartPage] = useState(0);
  const [diskon, setDiskon] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState("cash"); // "cash" | "card" | "hutang"

  // Customers state
  const [customers, setCustomers] = useState([{ id: 0, nama: "Pelanggan Umum", nohp: "-", alamat: "" }]);
  const [selectedCustomer, setSelectedCustomer] = useState({ id: 0, nama: "Pelanggan Umum", nohp: "-", alamat: "" });
  const [showAddCustomer, setShowAddCustomer] = useState(false);
  const [newCustomerForm, setNewCustomerForm] = useState({ nama: "", nohp: "", alamat: "" });
  const [customerSaving, setCustomerSaving] = useState(false);

  // Pending transactions state
  const [pendingCarts, setPendingCarts] = useState([]);
  const [showPendingModal, setShowPendingModal] = useState(false);

  // Modals & History
  const [showPayment, setShowPayment] = useState(false);
  const [returTarget, setReturTarget] = useState(null);

  // "summary" | "today" | "all"
  const [historyTab, setHistoryTab] = useState("summary");

  const [orderSearch, setOrderSearch] = useState("");
  const [orderPage, setOrderPage] = useState(0);
  const [expandedOrderId, setExpandedOrderId] = useState(null);

  const todayStr = useMemo(() => new Date().toISOString().split("T")[0], []);
  const [allHistoryFrom, setAllHistoryFrom] = useState(() => getDefaultAllHistoryFrom());
  const [allHistoryTo, setAllHistoryTo] = useState(todayStr);
  const [allHistoryOrders, setAllHistoryOrders] = useState([]);
  const [allHistoryLoading, setAllHistoryLoading] = useState(false);
  const [allHistorySearch, setAllHistorySearch] = useState("");
  const [allHistoryPage, setAllHistoryPage] = useState(0);
  const [allHistoryExpandedId, setAllHistoryExpandedId] = useState(null);
  const [allHistoryLoaded, setAllHistoryLoaded] = useState(false);

  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  const catalogSearchRef = useRef(null);
  const cartSearchRef = useRef(null);
  const customPriceRef = useRef(null);
  const customQtyRef = useRef(null);

  function focusCatalogSearch() {
    catalogSearchRef.current?.focus();
    catalogSearchRef.current?.select?.();
  }

  function focusCustomPrice() {
    customPriceRef.current?.focus();
    customPriceRef.current?.select?.();
  }

  function focusCustomQty() {
    customQtyRef.current?.focus();
    customQtyRef.current?.select?.();
  }

  function playScannerBeep() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(1760, ctx.currentTime);
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.07);
    } catch {}
  }

  async function loadCustomers() {
    try {
      const res = await window.posApi.getOnlineCustomers();
      if (res && res.data) {
        setCustomers(res.data);
        if (res.data.length > 0 && (!selectedCustomer || selectedCustomer.id === 0)) {
          setSelectedCustomer(res.data[0]);
        }
      }
    } catch (err) {
      console.warn("Failed to load customers:", err.message);
    }
  }

  async function loadCatalog(forceReload) {
    try {
      setCatalogLoading(true);
      if (catalogSource === "api") {
        setStatus(forceReload ? "Memperbarui produk dari Web Server..." : "Memuat produk dari Web Server...");
        const res = await window.posApi.getOnlineProducts({
          search: catalogSearch.trim() || undefined
        });

        if (res && res.products) {
          const rawProds = res.products;
          const formatted = rawProds.map((p) => ({
            id: String(p.id_produk),
            productId: p.id_produk,
            title: p.nama_produk,
            category: p.kategori_nama || "Umum",
            kategori_id: p.kategori_id,
            price: Number(p.harga) || 0,
            stock: Number(p.stok) || 0,
            barcode: p.barcode || "",
            sku: p.barcode || "",
            unit: p.satuan_nama || "Pcs",
            limitHarian: p.limit_harian || 0,
            isRegisteredOnly: Boolean(p.khusus_pelanggan_terdaftar),
            image: p.image || "",
            variants: [
              {
                id: String(p.id_produk),
                title: p.satuan_nama || "Pcs",
                price: Number(p.harga) || 0,
                sku: p.barcode || ""
              }
            ]
          }));

          const categories = [
            ...new Set(formatted.map((p) => p.category).filter(Boolean))
          ].sort((a, b) => a.localeCompare(b, "id"));

          setCatalog({
            products: formatted,
            categories,
            sourceFilesCount: 1,
            loadedAt: new Date().toISOString(),
            source: res.source,
            warning: res.warning
          });

          if (formatted.length > 0 && !selectedProductId) {
            setSelectedProductId(formatted[0].id);
          }

          if (res.warning) {
            setStatus(`⚠️ ${res.warning} (${formatted.length} produk tersimpan lokal)`);
          } else {
            setStatus(`✓ ${formatted.length} produk realtime tersinkronisasi dari Web POS.`);
          }
        }
      } else if (catalogSource === "csv") {
        setStatus(forceReload ? "Memuat ulang katalog CSV..." : "Memuat katalog CSV Shopify...");
        const data = forceReload ? await window.posApi.reloadCatalog() : await window.posApi.getCatalog();
        setCatalog(data);
        if (data.products.length > 0 && !selectedProductId) {
          setSelectedProductId(data.products[0].id);
        }
        setStatus(`${data.products.length} produk bersumber dari file CSV.`);
      } else {
        setStatus("Memuat katalog produk manual...");
        const data = await window.posApi.getManualCatalog();
        setCatalog(data);
        if (data.products.length > 0 && !selectedProductId) {
          setSelectedProductId(data.products[0].id);
        }
        setStatus(`${data.products.length} produk manual aktif.`);
      }
    } catch (err) {
      setStatus(`Gagal memuat katalog: ${err.message}`);
    } finally {
      setCatalogLoading(false);
    }
  }

  useEffect(() => {
    loadCatalog(false).catch(() => {});
    loadCustomers().catch(() => {});
  }, [catalogSource]);

  useEffect(() => {
    focusCatalogSearch();
  }, []);

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

      const skuMatch = p.variants?.some((v) => (v.sku || "").toLowerCase().includes(q)) || (p.barcode && p.barcode.toLowerCase().includes(q));
      return (
        p.title.toLowerCase().includes(q) ||
        (p.category || "").toLowerCase().includes(q) ||
        skuMatch
      );
    });
  }, [catalog.products, activeCategory, catalogSearch]);

  const isCustomFallbackMode = filteredProducts.length === 0 && Boolean(catalogSearch.trim()) && catalogSource !== "api";

  const cartSubtotal = useMemo(() => {
    return cart.reduce((s, item) => s + item.price * item.qty, 0);
  }, [cart]);

  const grandTotal = useMemo(() => {
    return Math.max(cartSubtotal - (Number(diskon) || 0), 0);
  }, [cartSubtotal, diskon]);

  const filteredCart = useMemo(() => {
    if (!cartSearch.trim()) return cart;
    const q = cartSearch.toLowerCase();
    return cart.filter((i) => i.title.toLowerCase().includes(q) || (i.sku || "").toLowerCase().includes(q));
  }, [cart, cartSearch]);

  const cartTotalPages = Math.max(1, Math.ceil(filteredCart.length / CART_PAGE_SIZE));
  const pagedCart = filteredCart.slice(cartPage * CART_PAGE_SIZE, (cartPage + 1) * CART_PAGE_SIZE);

  function addVariantToCart(product, variant) {
    if (!canCreateOrder) {
      setStatus("Akun ini tidak memiliki akses membuat order.");
      return;
    }

    const pId = product.productId || product.id;
    const existingIdx = cart.findIndex((i) => (i.productId && i.productId === pId) || i.title === product.title);

    if (existingIdx >= 0) {
      setCart((prev) =>
        prev.map((item, idx) =>
          idx === existingIdx ? { ...item, qty: item.qty + 1 } : item
        )
      );
    } else {
      setCart((prev) => [
        ...prev,
        {
          id: Date.now() + Math.random(),
          productId: pId,
          id_produk: pId,
          title: product.title,
          price: Number(variant?.price || product.price) || 0,
          qty: 1,
          sku: variant?.sku || product.barcode || null,
          barcode: product.barcode || variant?.sku || null,
          variantTitle: variant?.title || null,
          productHandle: product.handle || null,
          stock: product.stock
        }
      ]);
    }
    setStatus(`✓ "${product.title}" masuk keranjang.`);
  }

  function handleBarcodeScan(inputQuery) {
    const q = String(inputQuery || "").trim().toLowerCase();
    if (!q) return false;

    const match = catalog.products.find(
      (p) => (p.barcode && p.barcode.toLowerCase() === q) ||
             (p.sku && p.sku.toLowerCase() === q) ||
             (p.variants && p.variants.some((v) => (v.sku || "").toLowerCase() === q))
    );

    if (match) {
      playScannerBeep();
      addVariantToCart(match, match.variants?.[0]);
      setCatalogSearch("");
      focusCatalogSearch();
      return true;
    }

    return false;
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
    focusCatalogSearch();
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

  function clearCart() {
    if (cart.length === 0) return;
    setCart([]);
    setDiskon(0);
    setStatus("Keranjang dikosongkan.");
    focusCatalogSearch();
  }

  function handleHoldPending() {
    if (cart.length === 0) {
      setStatus("Keranjang kosong, tidak ada order untuk di-pending.");
      return;
    }

    const now = new Date();
    const pendingItem = {
      id: `PND-${now.getTime()}`,
      time: now.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }),
      customer: selectedCustomer,
      items: [...cart],
      diskon: Number(diskon) || 0,
      total: grandTotal
    };

    setPendingCarts((prev) => [pendingItem, ...prev]);
    setCart([]);
    setDiskon(0);
    setStatus(`✓ Order berhasil di-pending (${pendingCarts.length + 1} order tersimpan).`);
    focusCatalogSearch();
  }

  function restorePendingCart(pendingItem) {
    setCart(pendingItem.items);
    setDiskon(pendingItem.diskon || 0);
    if (pendingItem.customer) {
      setSelectedCustomer(pendingItem.customer);
    }
    setPendingCarts((prev) => prev.filter((p) => p.id !== pendingItem.id));
    setShowPendingModal(false);
    setStatus(`✓ Order "${pendingItem.id}" dipulihkan.`);
    focusCatalogSearch();
  }

  async function handleQuickAddCustomer(e) {
    e.preventDefault();
    if (!newCustomerForm.nama.trim()) return;

    try {
      setCustomerSaving(true);
      const res = await window.posApi.createOnlineCustomer(newCustomerForm);
      if (res && res.data) {
        const added = res.data;
        setCustomers((prev) => [added, ...prev]);
        setSelectedCustomer(added);
        setShowAddCustomer(false);
        setNewCustomerForm({ nama: "", nohp: "", alamat: "" });
        setStatus(`✓ Pelanggan "${added.nama}" berhasil ditambahkan.`);
      }
    } catch (err) {
      setStatus(`Gagal tambah pelanggan: ${err.message}`);
    } finally {
      setCustomerSaving(false);
    }
  }

  async function handlePaymentDone(method, cashGiven, qrisMeta = null, printAction = "hanya_cetak") {
    if (!canCreateOrder) {
      setStatus("Akun ini tidak memiliki akses membuat order.");
      return;
    }

    try {
      setLoading(true);
      setStatus("Memproses transaksi...");

      const result = await window.posApi.createOrder({
        items: cart.map(({ productId, id_produk, title, price, qty, sku, barcode, variantTitle, productHandle, satuan_id, harga_id }) => ({
          productId: productId || id_produk,
          id_produk: productId || id_produk,
          title,
          price,
          qty,
          sku: barcode || sku,
          barcode: barcode || sku,
          variantTitle,
          productHandle,
          satuan_id,
          harga_id
        })),
        idpelanggan: selectedCustomer?.id || 0,
        customerName: selectedCustomer?.nama || "Pelanggan Umum",
        diskon: Number(diskon) || 0,
        paymentMethod: method,
        cashGiven: method === "cash" ? Number(cashGiven) : null,
        qrisMeta: method === "qris" ? qrisMeta : null,
        printAction
      });

      setCart([]);
      setDiskon(0);
      setCartPage(0);
      setShowPayment(false);

      const invoiceNum = result.order?.nofaktur || result.order?.id;
      setStatus(`✓ Transaksi berhasil (#${invoiceNum}). ${result.printResult?.message || ""}`);
      onRefresh();
      focusCatalogSearch();
    } catch (err) {
      setStatus(`Gagal transaksi: ${err.message}`);
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

      // [ F1 ]: Switch to Order History
      if (e.key === "F1") {
        e.preventDefault();
        setHistoryTab("today");
        return;
      }

      // [ F4 ]: Focus search / barcode scanner
      if (e.key === "F4") {
        e.preventDefault();
        focusCatalogSearch();
        return;
      }

      // [ F5 ]: Open payment modal
      if (e.key === "F5") {
        e.preventDefault();
        if (canCreateOrder && cart.length > 0 && !loading) {
          setShowPayment(true);
          if (document.activeElement instanceof HTMLElement) {
            document.activeElement.blur();
          }
        }
        return;
      }

      // [ F11 ]: Hold / Pending transaction
      if (e.key === "F11") {
        e.preventDefault();
        handleHoldPending();
        return;
      }

      // Escape: Close modals
      if (e.key === "Escape") {
        if (showPayment) setShowPayment(false);
        if (showAddCustomer) setShowAddCustomer(false);
        if (showPendingModal) setShowPendingModal(false);
        if (returTarget) setReturTarget(null);
        return;
      }

      if (e.key === "Enter" && document.activeElement === catalogSearchRef.current) {
        e.preventDefault();
        const scanned = handleBarcodeScan(catalogSearch);
        if (!scanned) {
          if (filteredProducts.length === 1) {
            playScannerBeep();
            addVariantToCart(filteredProducts[0], filteredProducts[0].variants?.[0]);
            setCatalogSearch("");
            focusCatalogSearch();
          } else if (isCustomFallbackMode) {
            focusCustomPrice();
          }
        }
        return;
      }

      if (isTyping && !(e.ctrlKey || e.metaKey)) return;

      if ((e.ctrlKey || e.metaKey) && key === "b") {
        e.preventDefault();
        if (canCreateOrder && cart.length > 0 && !loading) {
          setShowPayment(true);
          if (document.activeElement instanceof HTMLElement) {
            document.activeElement.blur();
          }
        }
        return;
      }
    }

    window.addEventListener("keydown", onKeydown);
    return () => window.removeEventListener("keydown", onKeydown);
  }, [cart, loading, canCreateOrder, isCustomFallbackMode, selectedProduct, filteredProducts, catalogSearch, showPayment, showAddCustomer, showPendingModal, returTarget, grandTotal]);

  return (
    <div className={`custom-order-shell ${compactMode ? "compact-order-shell" : ""}`}>
      {/* DreamPOS Top Shortcuts Banner */}
      <section className="panel order-shortcut-panel" style={{ background: "#f8fafc", padding: "8px 14px", marginBottom: "10px" }}>
        <p className="small-text" style={{ margin: 0, fontWeight: 600, color: "#334155" }}>
          <strong style={{ color: "#0d9488" }}>[ F4 ]</strong> Scan Barcode / Cari Produk &nbsp;|&nbsp;
          <strong style={{ color: "#0d9488" }}>[ F5 ]</strong> Bayar &nbsp;|&nbsp;
          <strong style={{ color: "#7c3aed" }}>[ F11 ]</strong> Pending &nbsp;|&nbsp;
          <strong style={{ color: "#2563eb" }}>[ F1 ]</strong> Riwayat &nbsp;|&nbsp;
          <strong style={{ color: "#dc2626" }}>[ Esc ]</strong> Batal / Tutup Modal
        </p>
      </section>

      <div className="order-main-grid">
        {/* LEFT COLUMN: Products / Categories */}
        <section className="panel form-panel form-panel-inline order-catalog-panel">
          <div className="catalog-header-row">
            <div>
              <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
                Katalog Produk
                {catalog.source === "offline-cache" ? (
                  <span className="badge badge-offline" style={{ fontSize: "0.75rem" }}>Offline Cache</span>
                ) : (
                  <span className="badge badge-nofaktur" style={{ fontSize: "0.75rem", background: "#0d9488", color: "#fff" }}>Web POS Live</span>
                )}
              </h2>
              <p className="small-text catalog-meta-text">
                {catalog.products.length || 0} produk tersedia
              </p>
            </div>
            <div className="variant-actions">
              <button
                className={`category-pill ${catalogSource === "api" ? "active" : ""}`}
                onClick={() => setCatalogSource("api")}
                disabled={catalogLoading}
              >
                🌐 Web POS
              </button>
              <button
                className={`category-pill ${catalogSource === "manual" ? "active" : ""}`}
                onClick={() => setCatalogSource("manual")}
                disabled={catalogLoading}
              >
                ✏️ Manual
              </button>
              <button
                className={`category-pill ${catalogSource === "csv" ? "active" : ""}`}
                onClick={() => setCatalogSource("csv")}
                disabled={catalogLoading}
              >
                📁 CSV
              </button>
              <button className="btn btn-secondary" onClick={() => loadCatalog(true)} disabled={catalogLoading} style={{ padding: "4px 10px", fontSize: "0.82rem" }}>
                {catalogLoading ? "Memuat..." : "🔄 Sinkron"}
              </button>
            </div>
          </div>

          {/* Search & Categories Bar */}
          <div className="catalog-toolbar" style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              ref={catalogSearchRef}
              className="search-input catalog-search"
              type="text"
              placeholder="[ F4 ] Cari nama atau scan barcode produk..."
              value={catalogSearch}
              onChange={(e) => setCatalogSearch(e.target.value)}
              autoFocus
              disabled={catalogLoading}
              style={{ flex: 1 }}
            />
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setViewMode((m) => (m === "grid" ? "list" : "grid"))}
              title={viewMode === "grid" ? "Ubah ke Tampilan List" : "Ubah ke Tampilan Grid"}
              style={{ padding: "8px 12px" }}
            >
              {viewMode === "grid" ? "📋 List" : "⊞ Grid"}
            </button>
          </div>

          {/* Category Filter Pills */}
          <div className="category-pills" style={{ marginTop: 8 }}>
            <button
              className={`category-pill ${activeCategory === "all" ? "active" : ""}`}
              onClick={() => setActiveCategory("all")}
              disabled={catalogLoading}
            >
              Semua Kategori
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

          {/* Products List / Grid */}
          <div className="catalog-layout" style={{ marginTop: 12 }}>
            <div className={`catalog-products-list ${viewMode === "list" ? "view-list-mode" : "view-grid-mode"}`} style={{ display: "grid", gridTemplateColumns: viewMode === "grid" ? "repeat(auto-fill, minmax(180px, 1fr))" : "1fr", gap: 10 }}>
              {filteredProducts.length === 0 && (
                <div className="manual-fallback-box" style={{ gridColumn: "1 / -1", textAlign: "center", padding: 30 }}>
                  <div className="empty-cell">Tidak ada produk ditemukan untuk pencarian ini.</div>
                </div>
              )}
              {filteredProducts.map((p) => {
                const isOutOfStock = p.stock <= 0;
                return (
                  <button
                    key={p.id}
                    type="button"
                    className={`product-card-enhanced ${selectedProductId === p.id ? "active" : ""}`}
                    onClick={() => {
                      setSelectedProductId(p.id);
                      if (canCreateOrder && p.variants?.length > 0) {
                        playScannerBeep();
                        addVariantToCart(p, p.variants[0]);
                      }
                    }}
                  >
                    {p.image ? (
                      <img src={p.image} alt={p.title} className="product-card-image" />
                    ) : (
                      <div className="product-card-image" style={{ display: "flex", alignItems: "center", justifyContent: "center", color: "#94a3b8", fontSize: "1.5rem" }}>
                        📦
                      </div>
                    )}
                    <div className="product-card-title" style={{ fontWeight: 700, fontSize: "0.92rem", marginBottom: 2 }}>
                      {p.title}
                    </div>
                    <div className="product-card-meta" style={{ display: "flex", justifyContent: "space-between", fontSize: "0.78rem", color: "#64748b" }}>
                      <span>{p.category}</span>
                      {p.barcode && <span className="mono">{p.barcode}</span>}
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
                      <div style={{ fontWeight: 800, color: "#0d9488", fontSize: "1rem" }}>
                        {formatRupiah(p.price)}
                      </div>
                      <span className={`product-stock-badge ${p.stock > 10 ? "stock-ok" : (p.stock > 0 ? "stock-low" : "stock-empty")}`}>
                        {isOutOfStock ? "Habis" : `Stok: ${p.stock}`}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {status && <div className="status" style={{ marginTop: 10 }}>{status}</div>}
        </section>

        {/* RIGHT COLUMN: Order Details / Cart (DreamPOS Layout) */}
        <section className="panel cart-panel cart-panel-full order-cart-panel theiaStickySidebar">
          <div className="customer-info" style={{ marginBottom: 12 }}>
            <div className="order-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <h3 style={{ margin: 0, fontSize: "1.1rem" }}>Daftar Penjualan</h3>
              <span className="badge badge-nofaktur">#LIVE-POS</span>
            </div>

            {/* Customer dropdown + quick add */}
            <div className="customer-select-row">
              <select
                value={selectedCustomer?.id || 0}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  const found = customers.find((c) => c.id === val);
                  setSelectedCustomer(found || { id: 0, nama: "Pelanggan Umum", nohp: "-", alamat: "" });
                }}
              >
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nama} {c.nohp && c.nohp !== "-" ? `(${c.nohp})` : ""}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn-quick-customer"
                title="Tambah Pelanggan Cepat"
                onClick={() => setShowAddCustomer(true)}
              >
                +
              </button>
            </div>
          </div>

          {/* Cart Header */}
          <div className="cart-header-dream">
            <h5 style={{ margin: 0, fontSize: "0.95rem" }}>Detail Penjualan</h5>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {cart.length > 0 && (
                <button type="button" className="btn-clear-cart" onClick={clearCart}>
                  Reset
                </button>
              )}
              <span className="badge-count">Barang : <strong style={{ color: "#0d9488" }}>{cart.length}</strong></span>
            </div>
          </div>

          {/* Cart Items List */}
          <div className="table-wrap cart-table-wrap" style={{ maxHeight: "36vh", overflowY: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>Barang</th>
                  <th>Harga</th>
                  <th style={{ textAlign: "center" }}>Qty</th>
                  <th>Subtotal</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {cart.length === 0 ? (
                  <tr>
                    <td colSpan="5" className="empty-cell" style={{ padding: "24px 10px", textAlign: "center", color: "#94a3b8" }}>
                      Keranjang kosong. Scan barcode atau klik produk untuk menambahkan.
                    </td>
                  </tr>
                ) : (
                  cart.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <strong>{item.title}</strong>
                        {item.barcode && <div className="mono small-text" style={{ fontSize: "0.72rem" }}>{item.barcode}</div>}
                      </td>
                      <td>{formatRupiah(item.price)}</td>
                      <td style={{ textAlign: "center" }}>
                        <div className="qty-row-sm">
                          <button className="btn-qty-sm" onClick={() => updateQty(item.id, -1)}>
                            −
                          </button>
                          <span style={{ minWidth: 20, textAlign: "center", fontWeight: 700 }}>{item.qty}</span>
                          <button className="btn-qty-sm" onClick={() => updateQty(item.id, 1)}>
                            +
                          </button>
                        </div>
                      </td>
                      <td className="txt-in" style={{ fontWeight: 700 }}>{formatRupiah(item.price * item.qty)}</td>
                      <td>
                        <button className="btn-remove" onClick={() => removeFromCart(item.id)}>
                          ×
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Order Summary Table */}
          <table className="summary-table-dream">
            <tbody>
              <tr>
                <td>Sub Total</td>
                <td style={{ textAlign: "right", fontWeight: 600 }}>{formatRupiah(cartSubtotal)}</td>
              </tr>
              <tr>
                <td>
                  <span style={{ color: "#ef4444" }}>Diskon (Rp)</span>
                </td>
                <td style={{ textAlign: "right" }}>
                  <input
                    type="number"
                    min="0"
                    step="500"
                    className="discount-input"
                    value={diskon}
                    onChange={(e) => setDiskon(Math.max(0, Number(e.target.value) || 0))}
                  />
                </td>
              </tr>
              <tr className="grand-total-row">
                <td>Grand Total</td>
                <td style={{ textAlign: "right", color: "#0d9488" }}>{formatRupiah(grandTotal)}</td>
              </tr>
            </tbody>
          </table>

          {/* Payment Method Selector */}
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: "0.85rem", fontWeight: 600, color: "#475569", marginBottom: 4 }}>Metode Pembayaran</div>
            <div className="payment-methods-grid">
              <div
                className={`payment-tile ${paymentMethod === "cash" ? "active" : ""}`}
                onClick={() => setPaymentMethod("cash")}
              >
                <span className="icon">💵</span>
                <span>Tunai</span>
              </div>
              <div
                className={`payment-tile ${paymentMethod === "card" ? "active" : ""}`}
                onClick={() => setPaymentMethod("card")}
              >
                <span className="icon">💳</span>
                <span>Non Tunai</span>
              </div>
              <div
                className={`payment-tile ${paymentMethod === "hutang" ? "active" : ""}`}
                onClick={() => setPaymentMethod("hutang")}
              >
                <span className="icon">📑</span>
                <span>Hutang</span>
              </div>
            </div>
          </div>

          {/* DreamPOS Action Buttons */}
          <div className="action-buttons-dream">
            <button
              type="button"
              className="btn btn-teal"
              disabled={loading || cart.length === 0 || !canCreateOrder}
              onClick={() => setShowPayment(true)}
            >
              [ F5 ] Bayar
            </button>
            <button
              type="button"
              className="btn btn-purple"
              disabled={loading || cart.length === 0}
              onClick={handleHoldPending}
            >
              [ F11 ] Pending
            </button>
          </div>

          {pendingCarts.length > 0 && (
            <div style={{ marginTop: 10, textAlign: "center" }}>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ width: "100%", padding: "6px", fontSize: "0.82rem" }}
                onClick={() => setShowPendingModal(true)}
              >
                📑 Lihat Order Pending ({pendingCarts.length})
              </button>
            </div>
          )}
        </section>
      </div>

      {/* Order History Section */}
      <OrderHistoryPanel
        orders={orders}
        summary={summary}
        historyTab={historyTab}
        setHistoryTab={setHistoryTab}
        orderSearch={orderSearch}
        setOrderSearch={setOrderSearch}
        orderPage={orderPage}
        setOrderPage={setOrderPage}
        expandedOrderId={expandedOrderId}
        setExpandedOrderId={setExpandedOrderId}
        allHistoryFrom={allHistoryFrom}
        setAllHistoryFrom={setAllHistoryFrom}
        allHistoryTo={allHistoryTo}
        setAllHistoryTo={setAllHistoryTo}
        allHistoryOrders={allHistoryOrders}
        setAllHistoryOrders={setAllHistoryOrders}
        allHistoryLoading={allHistoryLoading}
        setAllHistoryLoading={setAllHistoryLoading}
        allHistorySearch={allHistorySearch}
        setAllHistorySearch={setAllHistorySearch}
        allHistoryPage={allHistoryPage}
        setAllHistoryPage={setAllHistoryPage}
        allHistoryExpandedId={allHistoryExpandedId}
        setAllHistoryExpandedId={setAllHistoryExpandedId}
        allHistoryLoaded={allHistoryLoaded}
        setAllHistoryLoaded={setAllHistoryLoaded}
        canRetur={canRetur}
        setReturTarget={setReturTarget}
        todayStr={todayStr}
      />

      {/* DreamPOS Payment Modal */}
      {showPayment && canCreateOrder && (
        <PaymentModal
          total={grandTotal}
          subtotal={cartSubtotal}
          diskon={Number(diskon) || 0}
          initialMethod={paymentMethod}
          customer={selectedCustomer}
          loading={loading}
          onPay={handlePaymentDone}
          onClose={() => setShowPayment(false)}
        />
      )}

      {/* Quick Add Customer Modal */}
      {showAddCustomer && (
        <div className="modal-overlay" onClick={() => setShowAddCustomer(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
            <h3>Tambah Pelanggan Baru</h3>
            <p className="small-text">Daftarkan pelanggan cepat untuk transaksi POS.</p>
            <form onSubmit={handleQuickAddCustomer}>
              <div className="database-form-group">
                <label>Nama Pelanggan *</label>
                <input
                  type="text"
                  required
                  autoFocus
                  value={newCustomerForm.nama}
                  onChange={(e) => setNewCustomerForm((p) => ({ ...p, nama: e.target.value }))}
                  placeholder="Contoh: Budi Santoso"
                />
              </div>
              <div className="database-form-group">
                <label>No. HP / WhatsApp</label>
                <input
                  type="text"
                  value={newCustomerForm.nohp}
                  onChange={(e) => setNewCustomerForm((p) => ({ ...p, nohp: e.target.value }))}
                  placeholder="Contoh: 081234567890"
                />
              </div>
              <div className="database-form-group">
                <label>Alamat</label>
                <input
                  type="text"
                  value={newCustomerForm.alamat}
                  onChange={(e) => setNewCustomerForm((p) => ({ ...p, alamat: e.target.value }))}
                  placeholder="Contoh: Padang"
                />
              </div>
              <div className="modal-actions" style={{ display: "flex", gap: 8, marginTop: 16 }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowAddCustomer(false)} disabled={customerSaving}>
                  Batal
                </button>
                <button type="submit" className="btn btn-teal" disabled={customerSaving}>
                  {customerSaving ? "Menyimpan..." : "Simpan Pelanggan"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Pending Orders Modal */}
      {showPendingModal && (
        <div className="modal-overlay" onClick={() => setShowPendingModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 580 }}>
            <h3>Daftar Transaksi Pending</h3>
            <p className="small-text">Pilih transaksi yang ingin dipulihkan ke kasir.</p>
            {pendingCarts.length === 0 ? (
              <p className="empty-cell" style={{ textAlign: "center", padding: 20 }}>Tidak ada transaksi yang dipending.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Waktu</th>
                      <th>Pelanggan</th>
                      <th>Item</th>
                      <th>Total</th>
                      <th>Aksi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendingCarts.map((pnd) => (
                      <tr key={pnd.id}>
                        <td>{pnd.time}</td>
                        <td>{pnd.customer?.nama || "Pelanggan Umum"}</td>
                        <td>{pnd.items.length} item</td>
                        <td className="txt-in" style={{ fontWeight: 700 }}>{formatRupiah(pnd.total)}</td>
                        <td>
                          <button
                            type="button"
                            className="btn btn-teal"
                            style={{ padding: "4px 10px", fontSize: "0.82rem" }}
                            onClick={() => restorePendingCart(pnd)}
                          >
                            Pulihkan
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="modal-actions" style={{ marginTop: 14 }}>
              <button type="button" className="btn btn-secondary" onClick={() => setShowPendingModal(false)}>
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Retur Modal */}
      {returTarget && canRetur && (
        <ReturModal
          order={returTarget.order}
          line={returTarget.line}
          loading={loading}
          onRetur={handleRetur}
          onClose={() => setReturTarget(null)}
        />
      )}
    </div>
  );
}

// ── Order History Panel ────────────────────────────────────────────────────

const ALL_HISTORY_PAGE_SIZE = 10;

function OrderTable({ orders, emptyMsg, expandedId, setExpandedId, canRetur, setReturTarget }) {
  const totalPages = Math.max(1, Math.ceil(orders.length / ALL_HISTORY_PAGE_SIZE));
  const [page, setPage] = useState(0);

  useEffect(() => {
    setPage(0);
  }, [orders.length]);

  useEffect(() => {
    if (page > totalPages - 1) {
      setPage(Math.max(0, totalPages - 1));
    }
  }, [page, totalPages]);

  const paged = orders.slice(page * ALL_HISTORY_PAGE_SIZE, (page + 1) * ALL_HISTORY_PAGE_SIZE);

  return (
    <>
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
            {paged.length === 0 && (
              <tr>
                <td colSpan="7" className="empty-cell">{emptyMsg}</td>
              </tr>
            )}
            {paged.map((ord) => (
              <Fragment key={ord.id}>
                <tr
                  className="order-row"
                  onClick={() => setExpandedId(expandedId === ord.id ? null : ord.id)}
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
                    <button className="btn-expand">{expandedId === ord.id ? "▲" : "▼"}</button>
                  </td>
                </tr>
                {expandedId === ord.id && (
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
                                {ln.returStatus !== "returned" && setReturTarget && (
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
                      {ord.returHistory?.length > 0 && (
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
      {orders.length > ALL_HISTORY_PAGE_SIZE && (
        <div className="paging">
          <button disabled={page <= 0} onClick={() => setPage((p) => p - 1)}>← Prev</button>
          <span>Hal {page + 1} / {totalPages}</span>
          <button disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)}>Next →</button>
        </div>
      )}
    </>
  );
}

function OrderHistoryPanel({
  orders, summary, historyTab, setHistoryTab,
  orderSearch, setOrderSearch, orderPage, setOrderPage,
  expandedOrderId, setExpandedOrderId,
  allHistoryFrom, setAllHistoryFrom, allHistoryTo, setAllHistoryTo,
  allHistoryOrders, setAllHistoryOrders, allHistoryLoading, setAllHistoryLoading,
  allHistorySearch, setAllHistorySearch, allHistoryPage, setAllHistoryPage,
  allHistoryExpandedId, setAllHistoryExpandedId,
  allHistoryLoaded, setAllHistoryLoaded,
  canRetur, setReturTarget, todayStr,
}) {
  const filteredToday = useMemo(() => {
    if (!orderSearch.trim()) return orders;
    const q = orderSearch.toLowerCase();
    return orders.filter(
      (o) =>
        o.id.toLowerCase().includes(q) ||
        o.paymentMethod.toLowerCase().includes(q) ||
        o.items.some((i) => i.title.toLowerCase().includes(q) || (i.sku || "").toLowerCase().includes(q))
    );
  }, [orders, orderSearch]);

  const filteredAll = useMemo(() => {
    if (!allHistorySearch.trim()) return allHistoryOrders;
    const q = allHistorySearch.toLowerCase();
    return allHistoryOrders.filter(
      (o) =>
        o.id.toLowerCase().includes(q) ||
        o.paymentMethod.toLowerCase().includes(q) ||
        o.items.some((i) => i.title.toLowerCase().includes(q) || (i.sku || "").toLowerCase().includes(q))
    );
  }, [allHistoryOrders, allHistorySearch]);

  async function loadAllHistory() {
    try {
      setAllHistoryLoading(true);
      const result = await window.posApi.getOrdersByDateRange({ from: allHistoryFrom, to: allHistoryTo });
      setAllHistoryOrders(Array.isArray(result) ? result : []);
      setAllHistoryPage(0);
      setAllHistoryExpandedId(null);
      setAllHistoryLoaded(true);
    } catch (err) {
      setAllHistoryOrders([]);
      setAllHistoryLoaded(true);
    } finally {
      setAllHistoryLoading(false);
    }
  }

  async function handleOnlineSync() {
    try {
      setAllHistoryLoading(true);
      const result = await window.posApi.onlineSyncTransactions();
      if (result?.success) {
        await loadAllHistory();
      }
      if (result?.message) {
        alert(result.message);
      }
    } catch (err) {
      alert(err.message || "Gagal melakukan sinkronisasi online.");
    } finally {
      setAllHistoryLoading(false);
    }
  }

  // Auto-load when switching to "all" tab for the first time
  useEffect(() => {
    if (historyTab === "all" && !allHistoryLoaded) {
      loadAllHistory();
    }
  }, [historyTab]);

  const allSummary = useMemo(() => {
    const paid = allHistoryOrders.filter((o) => o.status === "paid" || o.status === "partial-return");
    return {
      total: paid.reduce((s, o) => s + o.subtotal, 0),
      count: paid.length,
      cash: paid.filter((o) => o.paymentMethod === "cash").reduce((s, o) => s + o.subtotal, 0),
      qris: paid.filter((o) => o.paymentMethod === "qris").reduce((s, o) => s + o.subtotal, 0),
    };
  }, [allHistoryOrders]);

  return (
    <section className="panel order-history-panel">
      <div className="oh-header">
        <h2>Order History</h2>
        <div className="oh-tabs">
          <button
            className={`oh-tab-btn${historyTab === "summary" ? " oh-tab-active" : ""}`}
            onClick={() => setHistoryTab("summary")}
          >
            Summary Hari Ini
          </button>
          <button
            className={`oh-tab-btn${historyTab === "today" ? " oh-tab-active" : ""}`}
            onClick={() => setHistoryTab("today")}
          >
            Riwayat Hari Ini <span className="oh-badge">{orders.length}</span>
          </button>
          <button
            className={`oh-tab-btn${historyTab === "all" ? " oh-tab-active" : ""}`}
            onClick={() => setHistoryTab("all")}
          >
            Semua Riwayat Transaksi
          </button>
        </div>
      </div>

      {historyTab === "summary" && (
        <div className="oh-body">
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
        </div>
      )}

      {historyTab === "today" && (
        <div className="oh-body">
          <input
            className="search-input search-full"
            type="text"
            placeholder="Cari order (ID, barang, metode)..."
            value={orderSearch}
            onChange={(e) => { setOrderSearch(e.target.value); setOrderPage(0); }}
          />
          <OrderTable
            orders={filteredToday}
            emptyMsg={orders.length === 0 ? "Belum ada order hari ini." : "Tidak ditemukan."}
            expandedId={expandedOrderId}
            setExpandedId={setExpandedOrderId}
            canRetur={canRetur}
            setReturTarget={setReturTarget}
          />
        </div>
      )}

      {historyTab === "all" && (
        <div className="oh-body">
          <div className="oh-date-filter">
            <label>Dari</label>
            <input
              type="date"
              className="oh-date-input"
              value={allHistoryFrom}
              max={todayStr}
              onChange={(e) => setAllHistoryFrom(e.target.value)}
            />
            <label>Sampai</label>
            <input
              type="date"
              className="oh-date-input"
              value={allHistoryTo}
              max={todayStr}
              onChange={(e) => setAllHistoryTo(e.target.value)}
            />
            <button
              className="btn btn-secondary oh-search-btn"
              onClick={loadAllHistory}
              disabled={allHistoryLoading}
            >
              {allHistoryLoading ? "Memuat..." : "Tampilkan"}
            </button>
            <button
              className="btn btn-save oh-search-btn"
              onClick={handleOnlineSync}
              disabled={allHistoryLoading}
            >
              {allHistoryLoading ? "Sinkron..." : "Online Sync"}
            </button>
          </div>

          {allHistoryLoaded && (
            <div className="oh-all-summary">
              <span>{allSummary.count} order</span>
              <span>Total: <strong>{formatRupiah(allSummary.total)}</strong></span>
              <span>Cash: {formatRupiah(allSummary.cash)}</span>
              <span>QRIS: {formatRupiah(allSummary.qris)}</span>
            </div>
          )}

          <input
            className="search-input search-full"
            type="text"
            placeholder="Cari order (ID, barang, metode)..."
            value={allHistorySearch}
            onChange={(e) => { setAllHistorySearch(e.target.value); setAllHistoryPage(0); }}
          />

          {allHistoryLoaded ? (
            <OrderTable
              orders={filteredAll}
              emptyMsg={allHistoryOrders.length === 0 ? "Tidak ada order pada periode ini." : "Tidak ditemukan."}
              expandedId={allHistoryExpandedId}
              setExpandedId={setAllHistoryExpandedId}
              canRetur={false}
              setReturTarget={null}
            />
          ) : (
            <div className="empty-cell" style={{ padding: "24px 0", textAlign: "center" }}>
              {allHistoryLoading ? "Memuat data..." : "Pilih rentang tanggal lalu klik Tampilkan."}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
