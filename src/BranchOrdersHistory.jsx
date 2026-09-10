import { Fragment, useEffect, useMemo, useState } from "react";

function formatRupiah(value) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0
  }).format(Number(value || 0));
}

function formatDate(value) {
  if (!value) return "-";
  try {
    return new Intl.DateTimeFormat("id-ID", {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(new Date(value));
  } catch {
    return String(value);
  }
}

function getTodayStr() {
  return new Date().toISOString().split("T")[0];
}

function getYesterdayStr() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split("T")[0];
}

function getLast7DaysStr() {
  const d = new Date();
  d.setDate(d.getDate() - 6);
  return d.toISOString().split("T")[0];
}

function getStartOfMonthStr() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}-01`;
}

export default function BranchOrdersHistory({ onRefreshParent }) {
  const today = useMemo(() => getTodayStr(), []);

  // Filter states
  const [datePreset, setDatePreset] = useState("today");
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [channel, setChannel] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [activeSearch, setActiveSearch] = useState("");

  // Pagination states
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);

  // Data states
  const [orders, setOrders] = useState([]);
  const [summary, setSummary] = useState({ totalSales: 0, totalOrders: 0, totalCash: 0, totalQris: 0 });
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Row expand & reprint
  const [expandedId, setExpandedId] = useState(null);
  const [reprintingId, setReprintingId] = useState(null);

  function applyPreset(preset) {
    setDatePreset(preset);
    setPage(1);
    if (preset === "today") {
      setFromDate(today);
      setToDate(today);
    } else if (preset === "yesterday") {
      const y = getYesterdayStr();
      setFromDate(y);
      setToDate(y);
    } else if (preset === "last7") {
      setFromDate(getLast7DaysStr());
      setToDate(today);
    } else if (preset === "thisMonth") {
      setFromDate(getStartOfMonthStr());
      setToDate(today);
    }
  }

  async function fetchOrders(targetPage = page) {
    try {
      setLoading(true);
      setError(null);

      const params = {
        page: targetPage,
        limit,
        from: fromDate || undefined,
        to: toDate || undefined,
        channel: channel || undefined,
        paymentMethod: paymentMethod || undefined,
        search: activeSearch.trim() || undefined
      };

      const res = await window.posApi.fetchServerOrders(params);

      if (res && res.status === "success" && Array.isArray(res.orders)) {
        setOrders(res.orders);
        if (res.isOfflineFallback) {
          setError("Server Web POS sedang dalam pembaruan atau offline. Menampilkan riwayat transaksi lokal.");
        } else {
          setError(null);
        }
        if (res.summary) {
          setSummary({
            totalSales: Number(res.summary.totalSales) || 0,
            totalOrders: Number(res.summary.totalOrders) || 0,
            totalCash: Number(res.summary.totalCash) || 0,
            totalQris: Number(res.summary.totalQris) || 0
          });
        }
        if (res.pagination) {
          setPagination({
            page: Number(res.pagination.page) || targetPage,
            limit: Number(res.pagination.limit) || limit,
            total: Number(res.pagination.total) || res.orders.length,
            totalPages: Number(res.pagination.totalPages) || 1
          });
        }
        return;
      }

      // Fallback local if server unreachable
      const localOrders = await window.posApi.getOrdersByDateRange({ from: fromDate, to: toDate });
      if (Array.isArray(localOrders)) {
        setOrders(localOrders);
        const totalSales = localOrders.reduce((sum, o) => sum + (Number(o.total || o.totalBayar || o.subtotal) || 0), 0);
        const totalCash = localOrders.filter(o => o.paymentMethod === "cash").reduce((sum, o) => sum + (Number(o.total || o.totalBayar || o.subtotal) || 0), 0);
        const totalQris = localOrders.filter(o => o.paymentMethod === "qris").reduce((sum, o) => sum + (Number(o.total || o.totalBayar || o.subtotal) || 0), 0);
        setSummary({ totalSales, totalOrders: localOrders.length, totalCash, totalQris });
        setPagination({ page: 1, limit: localOrders.length || 20, total: localOrders.length, totalPages: 1 });
      }
    } catch (err) {
      console.error("fetchOrders error:", err);
      try {
        const localOrders = await window.posApi.getOrdersByDateRange({ from: fromDate, to: toDate });
        if (Array.isArray(localOrders)) {
          setOrders(localOrders);
          const totalSales = localOrders.reduce((sum, o) => sum + (Number(o.total || o.totalBayar || o.subtotal) || 0), 0);
          const totalCash = localOrders.filter(o => o.paymentMethod === "cash").reduce((sum, o) => sum + (Number(o.total || o.totalBayar || o.subtotal) || 0), 0);
          const totalQris = localOrders.filter(o => o.paymentMethod === "qris").reduce((sum, o) => sum + (Number(o.total || o.totalBayar || o.subtotal) || 0), 0);
          setSummary({ totalSales, totalOrders: localOrders.length, totalCash, totalQris });
          setPagination({ page: 1, limit: localOrders.length || 20, total: localOrders.length, totalPages: 1 });
          setError("Gagal terhubung ke server Web POS. Menampilkan riwayat transaksi offline lokal.");
          return;
        }
      } catch {}
      setError(err.message || "Gagal mengambil riwayat pesanan.");
    } finally {
      setLoading(false);
    }
  }

  // Reload data when filters change
  useEffect(() => {
    fetchOrders(page);
  }, [fromDate, toDate, channel, paymentMethod, activeSearch, limit, page]);

  function handleSearchSubmit(e) {
    if (e) e.preventDefault();
    setPage(1);
    setActiveSearch(searchInput);
  }

  function handleResetFilters() {
    setDatePreset("today");
    setFromDate(today);
    setToDate(today);
    setChannel("");
    setPaymentMethod("");
    setSearchInput("");
    setActiveSearch("");
    setPage(1);
  }

  async function handleReprint(e, ord) {
    e.stopPropagation();
    try {
      setReprintingId(ord.id);
      const res = await window.posApi.reprintOrder(ord);
      alert(res?.message || `✓ Struk #${ord.invoiceNumber || ord.nofaktur || ord.id} berhasil dicetak.`);
    } catch (err) {
      alert(`Gagal cetak ulang struk: ${err.message || err}`);
    } finally {
      setReprintingId(null);
    }
  }

  return (
    <div className="branch-orders-container" style={{ display: "flex", flexDirection: "column", gap: 16, width: "100%", height: "100%" }}>
      {/* Top Header & Refresh */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: "1.35rem", display: "flex", alignItems: "center", gap: 8 }}>
            <span>📋</span> Riwayat Pesanan & Transaksi Cabang
          </h2>
          <p className="small-text" style={{ margin: "4px 0 0 0", color: "#64748b" }}>
            Seluruh data transaksi penjualan real-time dari Desktop, Mobile, dan Web POS.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              fetchOrders(page);
              if (onRefreshParent) onRefreshParent();
            }}
            disabled={loading}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", fontWeight: 600 }}
          >
            <span>🔄</span> {loading ? "Memuat..." : "Refresh Data"}
          </button>
        </div>
      </div>

      {/* KPI Summary Cards */}
      <div className="summary-grid summary-grid-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
        <article className="summary-card" style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10, padding: 14 }}>
          <h3 style={{ fontSize: "0.82rem", color: "#64748b", margin: 0, textTransform: "uppercase" }}>Total Penjualan</h3>
          <p style={{ fontSize: "1.45rem", fontWeight: 800, color: "#0f766e", margin: "6px 0 0 0" }}>
            {formatRupiah(summary.totalSales)}
          </p>
        </article>

        <article className="summary-card" style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10, padding: 14 }}>
          <h3 style={{ fontSize: "0.82rem", color: "#64748b", margin: 0, textTransform: "uppercase" }}>Jumlah Transaksi</h3>
          <p style={{ fontSize: "1.45rem", fontWeight: 800, color: "#1e293b", margin: "6px 0 0 0" }}>
            {summary.totalOrders} <span style={{ fontSize: "0.9rem", fontWeight: 600, color: "#64748b" }}>Pesanan</span>
          </p>
        </article>

        <article className="summary-card" style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10, padding: 14 }}>
          <h3 style={{ fontSize: "0.82rem", color: "#64748b", margin: 0, textTransform: "uppercase" }}>Total Cash / Tunai</h3>
          <p style={{ fontSize: "1.45rem", fontWeight: 800, color: "#16a34a", margin: "6px 0 0 0" }}>
            {formatRupiah(summary.totalCash)}
          </p>
        </article>

        <article className="summary-card" style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10, padding: 14 }}>
          <h3 style={{ fontSize: "0.82rem", color: "#64748b", margin: 0, textTransform: "uppercase" }}>Total QRIS / Non-Tunai</h3>
          <p style={{ fontSize: "1.45rem", fontWeight: 800, color: "#2563eb", margin: "6px 0 0 0" }}>
            {formatRupiah(summary.totalQris)}
          </p>
        </article>
      </div>

      {/* Filter Toolbar Panel */}
      <section className="panel" style={{ padding: "14px 16px", margin: 0 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Preset Buttons & Custom Date Pickers */}
          <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <span style={{ fontSize: "0.83rem", fontWeight: 700, color: "#475569" }}>Periode:</span>
            <button
              type="button"
              className={`btn ${datePreset === "today" ? "btn-save" : "btn-secondary"}`}
              onClick={() => applyPreset("today")}
              style={{ padding: "5px 12px", fontSize: "0.8rem" }}
            >
              Hari Ini
            </button>
            <button
              type="button"
              className={`btn ${datePreset === "yesterday" ? "btn-save" : "btn-secondary"}`}
              onClick={() => applyPreset("yesterday")}
              style={{ padding: "5px 12px", fontSize: "0.8rem" }}
            >
              Kemarin
            </button>
            <button
              type="button"
              className={`btn ${datePreset === "last7" ? "btn-save" : "btn-secondary"}`}
              onClick={() => applyPreset("last7")}
              style={{ padding: "5px 12px", fontSize: "0.8rem" }}
            >
              7 Hari Terakhir
            </button>
            <button
              type="button"
              className={`btn ${datePreset === "thisMonth" ? "btn-save" : "btn-secondary"}`}
              onClick={() => applyPreset("thisMonth")}
              style={{ padding: "5px 12px", fontSize: "0.8rem" }}
            >
              Bulan Ini
            </button>

            <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: "auto", flexWrap: "wrap" }}>
              <span style={{ fontSize: "0.8rem", color: "#64748b" }}>Dari:</span>
              <input
                type="date"
                className="oh-date-input"
                value={fromDate}
                max={today}
                onChange={(e) => {
                  setFromDate(e.target.value);
                  setDatePreset("custom");
                  setPage(1);
                }}
                style={{ padding: "4px 8px", fontSize: "0.8rem", borderRadius: 6, border: "1px solid #cbd5e1" }}
              />
              <span style={{ fontSize: "0.8rem", color: "#64748b" }}>Sampai:</span>
              <input
                type="date"
                className="oh-date-input"
                value={toDate}
                max={today}
                onChange={(e) => {
                  setToDate(e.target.value);
                  setDatePreset("custom");
                  setPage(1);
                }}
                style={{ padding: "4px 8px", fontSize: "0.8rem", borderRadius: 6, border: "1px solid #cbd5e1" }}
              />
            </div>
          </div>

          {/* Secondary Filter Row: Channel, Payment, Search, Limit */}
          <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
            {/* Channel Dropdown */}
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <label style={{ fontSize: "0.82rem", fontWeight: 600, color: "#475569", margin: 0 }}>Channel:</label>
              <select
                value={channel}
                onChange={(e) => { setChannel(e.target.value); setPage(1); }}
                style={{ padding: "6px 10px", fontSize: "0.82rem", borderRadius: 6, border: "1px solid #cbd5e1" }}
              >
                <option value="">Semua Channel</option>
                <option value="desktop">🖥️ Desktop</option>
                <option value="mobile">📱 Mobile</option>
                <option value="web">🌐 Web POS</option>
              </select>
            </div>

            {/* Payment Dropdown */}
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <label style={{ fontSize: "0.82rem", fontWeight: 600, color: "#475569", margin: 0 }}>Pembayaran:</label>
              <select
                value={paymentMethod}
                onChange={(e) => { setPaymentMethod(e.target.value); setPage(1); }}
                style={{ padding: "6px 10px", fontSize: "0.82rem", borderRadius: 6, border: "1px solid #cbd5e1" }}
              >
                <option value="">Semua Metode</option>
                <option value="cash">💵 Cash / Tunai</option>
                <option value="qris">📱 QRIS / Card</option>
                <option value="hutang">⏳ Hutang</option>
              </select>
            </div>

            {/* Search Form */}
            <form onSubmit={handleSearchSubmit} style={{ display: "flex", gap: 6, flex: 1, minWidth: 240 }}>
              <input
                type="text"
                className="search-input"
                placeholder="Cari No. Faktur, Kasir, atau Pelanggan..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                style={{ flex: 1, padding: "6px 10px", fontSize: "0.82rem" }}
              />
              <button
                type="submit"
                className="btn btn-secondary"
                style={{ padding: "6px 12px", fontSize: "0.82rem", whiteSpace: "nowrap" }}
              >
                🔍 Cari
              </button>
              {activeSearch && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    setSearchInput("");
                    setActiveSearch("");
                    setPage(1);
                  }}
                  title="Hapus pencarian"
                  style={{ padding: "6px 10px", fontSize: "0.82rem" }}
                >
                  ✕
                </button>
              )}
            </form>

            {/* Limit Selector */}
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <label style={{ fontSize: "0.82rem", color: "#64748b", margin: 0 }}>Tampilkan:</label>
              <select
                value={limit}
                onChange={(e) => { setLimit(Number(e.target.value)); setPage(1); }}
                style={{ padding: "6px 8px", fontSize: "0.82rem", borderRadius: 6, border: "1px solid #cbd5e1" }}
              >
                <option value={10}>10</option>
                <option value={20}>20</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </div>

            {/* Reset Button */}
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleResetFilters}
              title="Reset seluruh filter ke Hari Ini"
              style={{ padding: "6px 10px", fontSize: "0.8rem", color: "#64748b" }}
            >
              Reset Filter
            </button>
          </div>
        </div>
      </section>

      {/* Error alert */}
      {error && (
        <div style={{ background: "#fef2f2", color: "#b91c1c", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 14px", fontSize: "0.85rem" }}>
          ⚠️ {error}
        </div>
      )}

      {/* Main Orders Table Panel */}
      <section className="panel" style={{ flex: 1, padding: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        <div className="table-wrap" style={{ flex: 1, overflowY: "auto", margin: 0 }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead style={{ position: "sticky", top: 0, background: "#f8fafc", zIndex: 2, borderBottom: "2px solid #e2e8f0" }}>
              <tr>
                <th style={{ padding: "10px 12px", textAlign: "left" }}>Waktu Transaksi</th>
                <th style={{ padding: "10px 12px", textAlign: "left" }}>No. Faktur / ID</th>
                <th style={{ padding: "10px 12px", textAlign: "center" }}>Channel</th>
                <th style={{ padding: "10px 12px", textAlign: "left" }}>Kasir & Pelanggan</th>
                <th style={{ padding: "10px 12px", textAlign: "center" }}>Item</th>
                <th style={{ padding: "10px 12px", textAlign: "center" }}>Metode Bayar</th>
                <th style={{ padding: "10px 12px", textAlign: "right" }}>Total Transaksi</th>
                <th style={{ padding: "10px 12px", textAlign: "center" }}>Status</th>
                <th style={{ padding: "10px 12px", textAlign: "right" }}>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {loading && orders.length === 0 ? (
                <tr>
                  <td colSpan="9" style={{ textAlign: "center", padding: "40px 0", color: "#64748b" }}>
                    <div style={{ fontSize: "1.2rem", marginBottom: 6 }}>⏳</div>
                    Memuat data transaksi dari server Web POS...
                  </td>
                </tr>
              ) : orders.length === 0 ? (
                <tr>
                  <td colSpan="9" style={{ textAlign: "center", padding: "40px 0", color: "#64748b" }}>
                    <div style={{ fontSize: "1.3rem", marginBottom: 6 }}>📭</div>
                    Tidak ada transaksi pada filter dan periode ini.
                  </td>
                </tr>
              ) : (
                orders.map((ord) => {
                  const ch = (ord.channel || (ord.source === "server" ? "web" : "desktop")).toLowerCase();
                  const invoiceDisplay = ord.invoiceNumber || ord.nofaktur || ord.id;
                  const isExpanded = expandedId === ord.id;
                  const isReprinting = reprintingId === ord.id;
                  const orderStatus = ord.status || "paid";

                  return (
                    <Fragment key={ord.id}>
                      <tr
                        className="order-row"
                        onClick={() => setExpandedId(isExpanded ? null : ord.id)}
                        style={{
                          cursor: "pointer",
                          background: isExpanded ? "#f0fdfa" : "transparent",
                          borderBottom: "1px solid #f1f5f9"
                        }}
                      >
                        <td style={{ padding: "10px 12px", fontSize: "0.84rem", color: "#475569" }}>
                          {formatDate(ord.createdAt || ord.date)}
                        </td>
                        <td style={{ padding: "10px 12px", fontFamily: "monospace", fontSize: "0.85rem" }}>
                          <div style={{ fontWeight: 700, color: "#0f172a" }}>{invoiceDisplay}</div>
                          {ord.offline_id && ord.offline_id !== invoiceDisplay && (
                            <div style={{ fontSize: "0.72rem", color: "#94a3b8" }}>{ord.offline_id}</div>
                          )}
                        </td>
                        <td style={{ padding: "10px 12px", textAlign: "center" }}>
                          {ch === "desktop" && <span className="channel-badge channel-desktop">🖥️ Desktop</span>}
                          {ch === "mobile" && <span className="channel-badge channel-mobile">📱 Mobile</span>}
                          {ch !== "desktop" && ch !== "mobile" && <span className="channel-badge channel-web">🌐 Web</span>}
                        </td>
                        <td style={{ padding: "10px 12px", fontSize: "0.84rem" }}>
                          <div style={{ fontWeight: 600, color: "#1e293b" }}>{ord.cashierName || ord.kasir || ord.nama_user || "Kasir"}</div>
                          <div style={{ fontSize: "0.74rem", color: "#64748b" }}>
                            {ord.customerName && ord.customerName !== "Pelanggan Umum" ? ord.customerName : "Pelanggan Umum"}
                          </div>
                        </td>
                        <td style={{ padding: "10px 12px", textAlign: "center", fontSize: "0.84rem" }}>
                          <span style={{ fontWeight: 600 }}>{ord.items?.length || ord.itemsCount || 0}</span> item
                        </td>
                        <td style={{ padding: "10px 12px", textAlign: "center", textTransform: "uppercase", fontSize: "0.8rem", fontWeight: 700 }}>
                          {ord.paymentMethod === "cash" ? (
                            <span style={{ color: "#16a34a" }}>Cash</span>
                          ) : (ord.paymentMethod === "qris" || ord.paymentMethod === "card") ? (
                            <span style={{ color: "#2563eb" }}>QRIS</span>
                          ) : (
                            <span style={{ color: "#d97706" }}>{ord.paymentMethod || "Cash"}</span>
                          )}
                        </td>
                        <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 800, color: "#0f766e", fontSize: "0.92rem" }}>
                          {formatRupiah(ord.total || ord.totalBayar || ord.subtotal)}
                        </td>
                        <td style={{ padding: "10px 12px", textAlign: "center" }}>
                          <span className={`badge badge-${orderStatus}`} style={{ fontSize: "0.75rem" }}>
                            {orderStatus === "paid" ? "Lunas" : orderStatus}
                          </span>
                        </td>
                        <td style={{ padding: "10px 12px", textAlign: "right", whiteSpace: "nowrap" }} onClick={(e) => e.stopPropagation()}>
                          <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", alignItems: "center" }}>
                            <button
                              type="button"
                              className="btn btn-secondary"
                              title="Cetak ulang struk termal transaksi ini"
                              onClick={(e) => handleReprint(e, ord)}
                              disabled={isReprinting}
                              style={{ padding: "4px 8px", fontSize: "0.78rem", fontWeight: 600 }}
                            >
                              {isReprinting ? "🖨️..." : "🖨️ Struk"}
                            </button>
                            <button
                              type="button"
                              className="btn-expand"
                              onClick={() => setExpandedId(isExpanded ? null : ord.id)}
                              title={isExpanded ? "Tutup rincian" : "Lihat rincian item"}
                            >
                              {isExpanded ? "▲" : "▼"}
                            </button>
                          </div>
                        </td>
                      </tr>

                      {/* Expandable Order Detail */}
                      {isExpanded && (
                        <tr>
                          <td colSpan="9" className="order-detail-cell" style={{ background: "#f8fafc", padding: "12px 16px" }}>
                            <div style={{ marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                              <strong style={{ fontSize: "0.85rem", color: "#334155" }}>
                                📦 Rincian Produk Pesanan #{invoiceDisplay}:
                              </strong>
                              <span style={{ fontSize: "0.8rem", color: "#64748b" }}>
                                Total: <strong>{formatRupiah(ord.total || ord.totalBayar || ord.subtotal)}</strong>
                                {ord.diskon > 0 && ` (Diskon: ${formatRupiah(ord.diskon)})`}
                              </span>
                            </div>

                            <table className="inner-table" style={{ width: "100%", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 6 }}>
                              <thead>
                                <tr style={{ background: "#f1f5f9", fontSize: "0.8rem" }}>
                                  <th style={{ textAlign: "left", padding: "6px 10px" }}>Nama Barang / Produk</th>
                                  <th style={{ textAlign: "right", padding: "6px 10px" }}>Harga</th>
                                  <th style={{ textAlign: "center", padding: "6px 10px" }}>Qty</th>
                                  <th style={{ textAlign: "right", padding: "6px 10px" }}>Subtotal</th>
                                </tr>
                              </thead>
                              <tbody>
                                {(ord.items || []).length === 0 ? (
                                  <tr>
                                    <td colSpan="4" style={{ textAlign: "center", padding: "10px", color: "#94a3b8", fontSize: "0.82rem" }}>
                                      Tidak ada data item tersimpan.
                                    </td>
                                  </tr>
                                ) : (
                                  (ord.items || []).map((it, idx) => (
                                    <tr key={it.id || idx} style={{ borderBottom: "1px solid #f1f5f9", fontSize: "0.82rem" }}>
                                      <td style={{ padding: "6px 10px", fontWeight: 600 }}>{it.title || it.nama_produk || "Produk"}</td>
                                      <td style={{ padding: "6px 10px", textAlign: "right" }}>{formatRupiah(it.price || it.harga_jual)}</td>
                                      <td style={{ padding: "6px 10px", textAlign: "center", fontWeight: 700 }}>{it.qty || it.jumlah_stok || 1}</td>
                                      <td style={{ padding: "6px 10px", textAlign: "right", fontWeight: 700, color: "#0f766e" }}>
                                        {formatRupiah(it.subtotal || it.lineTotal || ((it.price || 0) * (it.qty || 1)))}
                                      </td>
                                    </tr>
                                  ))
                                )}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Footer & Pagination Bar */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 16px", background: "#f8fafc", borderTop: "1px solid #e2e8f0", flexWrap: "wrap", gap: 10 }}>
          <div style={{ fontSize: "0.82rem", color: "#64748b" }}>
            Total <strong>{pagination.total}</strong> Transaksi • Halaman <strong>{pagination.page}</strong> dari <strong>{pagination.totalPages}</strong>
          </div>

          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={pagination.page <= 1 || loading}
              onClick={() => setPage(1)}
              title="Halaman Pertama"
              style={{ padding: "5px 10px", fontSize: "0.8rem" }}
            >
              ⏮️
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={pagination.page <= 1 || loading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              style={{ padding: "5px 12px", fontSize: "0.8rem" }}
            >
              ← Sebelumnya
            </button>
            <span style={{ fontSize: "0.84rem", fontWeight: 700, padding: "0 8px" }}>
              {pagination.page}
            </span>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={pagination.page >= pagination.totalPages || loading}
              onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
              style={{ padding: "5px 12px", fontSize: "0.8rem" }}
            >
              Selanjutnya →
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={pagination.page >= pagination.totalPages || loading}
              onClick={() => setPage(pagination.totalPages)}
              title="Halaman Terakhir"
              style={{ padding: "5px 10px", fontSize: "0.8rem" }}
            >
              ⏭️
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

