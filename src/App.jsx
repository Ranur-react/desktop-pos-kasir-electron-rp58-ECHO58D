import { useEffect, useMemo, useState } from "react";
import CustomOrder from "./CustomOrder";
import PrinterSettings from "./PrinterSettings";
import DatabaseSettings from "./DatabaseSettings";

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

export default function App() {
  const [tab, setTab] = useState("order"); // "kasir" | "order" | "printer" | "database"

  // -- Kasir state --
  const [nominal, setNominal] = useState("");
  const [description, setDescription] = useState("");
  const [transactions, setTransactions] = useState([]);
  const [summary, setSummary] = useState({ totalIn: 0, totalOut: 0, balance: 0 });
  const [printer, setPrinter] = useState(null);
  const [status, setStatus] = useState("Siap.");
  const [loading, setLoading] = useState(false);

  // -- Order state --
  const [orders, setOrders] = useState([]);
  const [orderSummary, setOrderSummary] = useState({
    totalSales: 0, totalOrders: 0, totalCash: 0, totalQris: 0, totalReturned: 0
  });

  const nominalNumber = useMemo(() => Number(nominal), [nominal]);

  async function loadBootstrap() {
    const data = await window.posApi.getBootstrap();
    setTransactions(data.transactions || []);
    setSummary(data.summary || { totalIn: 0, totalOut: 0, balance: 0 });
    setPrinter(data.printer || null);
  }

  async function loadOrders() {
    const data = await window.posApi.getOrders();
    setOrders(data.orders || []);
    setOrderSummary(data.summary || orderSummary);
  }

  useEffect(() => {
    loadBootstrap().catch((err) => setStatus(`Gagal memuat data: ${err.message}`));
    loadOrders().catch(() => {});
  }, []);

  async function submitTransaction(type) {
    if (!Number.isFinite(nominalNumber) || nominalNumber <= 0) {
      setStatus("Nominal harus angka dan lebih dari 0.");
      return;
    }
    try {
      setLoading(true);
      setStatus("Menyimpan transaksi...");
      const result = await window.posApi.addTransaction({
        type, nominal: nominalNumber, description, autoPrint: true
      });
      setTransactions(result.transactions || []);
      setSummary(result.summary || { totalIn: 0, totalOut: 0, balance: 0 });
      setNominal("");
      setDescription("");
      setStatus(result.printResult?.message || "Transaksi berhasil.");
    } catch (error) {
      setStatus(`Transaksi gagal: ${error.message}`);
    } finally {
      setLoading(false);
    }
  }

  async function printLastReceipt() {
    try {
      setLoading(true);
      setStatus("Mencetak struk terakhir...");
      const result = await window.posApi.printLastReceipt();
      setStatus(result.message || "Struk berhasil dicetak.");
    } catch (error) {
      setStatus(`Cetak gagal: ${error.message}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="app-shell">
      {/* ── Tab Navigation ── */}
      <nav className="tab-bar">
        <button className={`tab-btn ${tab === "order" ? "tab-active" : ""}`} onClick={() => setTab("order")}>
          Order Katalog
        </button>
        <button className={`tab-btn ${tab === "kasir" ? "tab-active" : ""}`} onClick={() => setTab("kasir")}>
          Kasir Cash
        </button>
        <button className={`tab-btn ${tab === "printer" ? "tab-active" : ""}`} onClick={() => setTab("printer")}>
          Printer
        </button>
        <button className={`tab-btn ${tab === "database" ? "tab-active" : ""}`} onClick={() => setTab("database")}>
          Database
        </button>
      </nav>

      {/* ── TAB: Custom Order ── */}
      {tab === "order" && (
        <CustomOrder orders={orders} summary={orderSummary} onRefresh={loadOrders} />
      )}

      {/* ── TAB: Kasir Cash ── */}
      {tab === "kasir" && (
        <>
          <section className="panel form-panel">
            <h1>POS Kasir Desktop</h1>
            <p className="small-text">Input transaksi cash harian dan cetak ke thermal printer.</p>

            <label htmlFor="nominal">Nominal (Rupiah)</label>
            <input id="nominal" type="number" min="0" step="100" placeholder="Contoh: 50000"
              value={nominal} onChange={(e) => setNominal(e.target.value)} disabled={loading} />

            <label htmlFor="description">Deskripsi Transaksi</label>
            <input id="description" type="text" placeholder="Contoh: Penjualan kopi"
              value={description} onChange={(e) => setDescription(e.target.value)} disabled={loading} />

            <div className="btn-row">
              <button className="btn btn-in" onClick={() => submitTransaction("in")} disabled={loading}>
                Uang Masuk
              </button>
              <button className="btn btn-out" onClick={() => submitTransaction("out")} disabled={loading}>
                Uang Keluar
              </button>
            </div>

            <button className="btn btn-print" onClick={printLastReceipt} disabled={loading}>
              Cetak Struk &amp; Buka Laci
            </button>

            <div className="status">Status: {status}</div>
            {printer && <div className="small-text">Printer: {printer.interface}</div>}
          </section>

          <section className="panel summary-panel">
            <h2>Summary Hari Ini</h2>
            <div className="summary-grid">
              <article><h3>Total Uang Masuk</h3><p>{formatRupiah(summary.totalIn)}</p></article>
              <article><h3>Total Uang Keluar</h3><p>{formatRupiah(summary.totalOut)}</p></article>
              <article><h3>Saldo Hari Ini</h3><p>{formatRupiah(summary.balance)}</p></article>
            </div>
          </section>

          <section className="panel history-panel">
            <h2>Riwayat Transaksi Harian</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Waktu</th><th>Jenis</th><th>Deskripsi</th><th>Nominal</th></tr>
                </thead>
                <tbody>
                  {transactions.length === 0 && (
                    <tr><td colSpan="4" className="empty-cell">Belum ada transaksi hari ini.</td></tr>
                  )}
                  {transactions.map((tx) => (
                    <tr key={tx.id}>
                      <td>{formatDate(tx.createdAt)}</td>
                      <td>{tx.type === "in" ? "Masuk" : "Keluar"}</td>
                      <td>{tx.description || "-"}</td>
                      <td className={tx.type === "in" ? "txt-in" : "txt-out"}>{formatRupiah(tx.nominal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {tab === "printer" && (
        <PrinterSettings onApplied={(cfg) => setPrinter(cfg || null)} />
      )}

      {tab === "database" && (
        <DatabaseSettings onApplied={() => {}} />
      )}
    </main>
  );
}
