import { useEffect, useRef, useState } from "react";

function formatRupiah(value) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0
  }).format(Number(value || 0));
}

function parseNumber(str) {
  if (typeof str === "number") return str;
  if (!str) return 0;
  const cleaned = String(str).replace(/[^\d]/g, "");
  return Number(cleaned) || 0;
}

export default function PaymentModal({
  total,
  subtotal,
  diskon = 0,
  initialMethod = "cash",
  customer = null,
  loading = false,
  onPay,
  onClose
}) {
  const [method, setMethod] = useState(initialMethod || "cash"); // "cash" | "qris" | "card" | "hutang"
  const [cashGiven, setCashGiven] = useState(String(total));
  const [qrisImage, setQrisImage] = useState("");
  const [qrisStatus, setQrisStatus] = useState("");
  const [qrisError, setQrisError] = useState("");
  const [qrisBusy, setQrisBusy] = useState(false);
  const [qrisReady, setQrisReady] = useState(false);

  const cashInputRef = useRef(null);

  const cashNum = parseNumber(cashGiven);
  const change = Math.max(cashNum - total, 0);
  const isShort = method === "cash" && cashNum < total;
  const canProcess = method !== "cash" || (cashNum >= total);
  const localLoading = loading || qrisBusy;

  useEffect(() => {
    // Focus cash input on open
    setTimeout(() => {
      cashInputRef.current?.focus();
      cashInputRef.current?.select();
    }, 50);
  }, []);

  // Pre-set cash amounts
  const quickAmounts = [
    { label: "Uang Pas", val: total },
    { label: "10.000", val: 10000 },
    { label: "20.000", val: 20000 },
    { label: "50.000", val: 50000 },
    { label: "100.000", val: 100000 },
    { label: "200.000", val: 200000 }
  ].filter((q) => q.label === "Uang Pas" || q.val >= total);

  useEffect(() => {
    function onKeydown(e) {
      if (localLoading) return;

      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }

      if (e.key === "Enter") {
        e.preventDefault();
        if (canProcess) {
          handleExecutePayment("hanya_cetak");
        }
      }
    }

    window.addEventListener("keydown", onKeydown);
    return () => window.removeEventListener("keydown", onKeydown);
  }, [method, canProcess, localLoading, cashNum, total]);

  // Load static QRIS image when QRIS selected
  useEffect(() => {
    if (method !== "qris") return;
    let active = true;
    (async () => {
      try {
        const result = await window.posApi.getQrisImage();
        if (active) {
          setQrisImage(result.imageDataUrl || "");
          setQrisReady(Boolean(result.imageDataUrl));
          if (!result.imageDataUrl) {
            setQrisError("QRIS belum dikonfigurasi di Pengaturan Toko.");
          }
        }
      } catch (err) {
        if (active) setQrisError(`Gagal memuat QRIS: ${err.message}`);
      }
    })();
    return () => {
      active = false;
    };
  }, [method]);

  function handleQuickAmount(amount) {
    setCashGiven(String(amount));
    cashInputRef.current?.focus();
  }

  function handleExecutePayment(printAction = "hanya_cetak") {
    if (!canProcess || localLoading) return;
    onPay(method, cashNum, method === "qris" ? { paid: true } : null, printAction);
  }

  return (
    <div className="modal-overlay" onClick={() => { if (!localLoading) onClose(); }}>
      <div className="modal payment-modal-dream" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header-dream">
          <div className="modal-title-group">
            <h3>Pembayaran Penjualan</h3>
            <p className="modal-subtitle">
              Pelanggan: <strong>{customer?.nama || "Pelanggan Umum"}</strong>
            </p>
          </div>
          <button className="btn-close-modal" onClick={onClose} disabled={localLoading}>
            ✕
          </button>
        </div>

        {/* Bill Summary Banner */}
        <div className="payment-total-banner">
          <div className="total-breakdown">
            {diskon > 0 && (
              <span className="total-sub">
                Subtotal: {formatRupiah(subtotal || total + diskon)} | Diskon: -{formatRupiah(diskon)}
              </span>
            )}
            <span className="total-label">Total Tagihan</span>
          </div>
          <div className="total-amount-display">{formatRupiah(total)}</div>
        </div>

        {/* Payment Methods */}
        <div className="payment-tabs-dream">
          <button
            type="button"
            className={`payment-tab-btn ${method === "cash" ? "active" : ""}`}
            onClick={() => setMethod("cash")}
          >
            💵 Tunai (Cash)
          </button>
          <button
            type="button"
            className={`payment-tab-btn ${method === "card" ? "active" : ""}`}
            onClick={() => setMethod("card")}
          >
            💳 Non Tunai / Transfer
          </button>
          <button
            type="button"
            className={`payment-tab-btn ${method === "qris" ? "active" : ""}`}
            onClick={() => setMethod("qris")}
          >
            📱 QRIS
          </button>
          <button
            type="button"
            className={`payment-tab-btn ${method === "hutang" ? "active" : ""}`}
            onClick={() => setMethod("hutang")}
          >
            📑 Hutang
          </button>
        </div>

        {/* Method Details */}
        {method === "cash" && (
          <div className="cash-payment-form">
            <div className="form-group-dream">
              <label htmlFor="jumlah_uang">Jumlah Uang Diterima (Rp)</label>
              <input
                ref={cashInputRef}
                id="jumlah_uang"
                type="text"
                className="form-control-dream cash-input-large"
                value={cashGiven}
                onChange={(e) => setCashGiven(e.target.value.replace(/[^\d]/g, ""))}
                placeholder={String(total)}
                disabled={localLoading}
              />
            </div>

            {/* Quick cash pills */}
            <div className="quick-cash-row">
              {quickAmounts.map((q, idx) => (
                <button
                  key={idx}
                  type="button"
                  className="quick-cash-pill"
                  onClick={() => handleQuickAmount(q.val)}
                >
                  {q.label === "Uang Pas" ? "Uang Pas" : formatRupiah(q.val)}
                </button>
              ))}
            </div>

            {/* Kembalian Display */}
            <div className={`kembalian-box ${isShort ? "is-short" : "is-change"}`}>
              {isShort ? (
                <>
                  <span className="kembalian-label">Uang Masih Kurang:</span>
                  <span className="kembalian-value text-danger">{formatRupiah(total - cashNum)}</span>
                </>
              ) : (
                <>
                  <span className="kembalian-label">Kembalian:</span>
                  <span className="kembalian-value text-success">{formatRupiah(change)}</span>
                </>
              )}
            </div>
          </div>
        )}

        {method === "card" && (
          <div className="card-payment-info">
            <p className="info-box-dream">
              Pembayaran Non-Tunai / EDC / Transfer Bank sebesar <strong>{formatRupiah(total)}</strong>.
              Pastikan pembayaran telah berhasil di mesin EDC atau mutasi rekening sebelum memproses struk.
            </p>
          </div>
        )}

        {method === "qris" && (
          <div className="qris-payment-box">
            {qrisImage ? (
              <div className="qris-preview">
                <img src={qrisImage} alt="QRIS" className="qris-image" />
                <p className="small-text">Scan QRIS di atas untuk membayar {formatRupiah(total)}</p>
              </div>
            ) : (
              <p className="txt-out">{qrisError || "Memuat QRIS..."}</p>
            )}
          </div>
        )}

        {method === "hutang" && (
          <div className="card-payment-info">
            <p className="info-box-dream warning">
              Transaksi akan dicatat sebagai <strong>Hutang / Piutang</strong> sebesar <strong>{formatRupiah(total)}</strong> atas nama <strong>{customer?.nama || "Pelanggan Umum"}</strong>.
            </p>
          </div>
        )}

        {/* Modal Footer Buttons */}
        <div className="modal-footer-dream">
          <button
            type="button"
            className="btn btn-secondary btn-cancel-dream"
            onClick={onClose}
            disabled={localLoading}
          >
            [ Esc ] Batal
          </button>
          <button
            type="button"
            className="btn btn-outline-primary btn-no-print-dream"
            onClick={() => handleExecutePayment("tidak_cetak")}
            disabled={!canProcess || localLoading}
          >
            Bayar Tanpa Cetak
          </button>
          <button
            type="button"
            className="btn btn-teal btn-pay-dream"
            onClick={() => handleExecutePayment("hanya_cetak")}
            disabled={!canProcess || localLoading}
          >
            {localLoading ? "Memproses..." : "[ Enter ] Bayar & Cetak Struk"}
          </button>
        </div>
      </div>
    </div>
  );
}

