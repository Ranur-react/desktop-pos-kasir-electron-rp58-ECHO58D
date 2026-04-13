import { useEffect, useState } from "react";

function formatRupiah(value) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0
  }).format(Number(value || 0));
}

export default function PaymentModal({ total, loading, onPay, onClose }) {
  const [method, setMethod] = useState(null); // null | "cash" | "qris"
  const [cashGiven, setCashGiven] = useState("");
  const [qrisImage, setQrisImage] = useState("");
  const [qrisStatus, setQrisStatus] = useState("");
  const [qrisError, setQrisError] = useState("");
  const [qrisBusy, setQrisBusy] = useState(false);
  const [qrisReady, setQrisReady] = useState(false);

  const cashNum = Number(cashGiven);
  const change = Number.isFinite(cashNum) ? cashNum - total : 0;
  const canProcessCash = method === "cash" && Number.isFinite(cashNum) && cashNum >= total;
  const localLoading = loading || qrisBusy;

  // Load static QRIS image when QRIS method selected
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
            setQrisError("QRIS_STATIC_CONTENT belum diisi di .env");
          }
        }
      } catch (err) {
        if (active) setQrisError(`Gagal memuat QRIS: ${err.message}`);
      }
    })();
    return () => { active = false; };
  }, [method]);

  function resetQrisState() {
    setQrisImage("");
    setQrisStatus("");
    setQrisError("");
    setQrisBusy(false);
    setQrisReady(false);
  }

  async function handlePrintQris() {
    try {
      setQrisBusy(true);
      setQrisStatus("Mencetak QRIS...");
      const result = await window.posApi.printQrisStatic({ amount: total });
      setQrisStatus(result.message || "QRIS tercetak.");
    } catch (err) {
      setQrisStatus(`Gagal cetak: ${err.message}`);
    } finally {
      setQrisBusy(false);
    }
  }

  async function confirmQrisPayment() {
    try {
      setQrisBusy(true);
      setQrisStatus("Menyimpan order...");
      await onPay("qris", null, { paid: true });
    } catch (err) {
      setQrisError(`Gagal: ${err.message}`);
    } finally {
      setQrisBusy(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={() => { if (!localLoading) onClose(); }}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Pembayaran</h2>
        <p className="modal-total">Total: <strong>{formatRupiah(total)}</strong></p>

        {/* Step 1: pilih metode */}
        {method === null && (
          <div className="payment-methods">
            <button className="btn btn-cash" onClick={() => setMethod("cash")}>Cash</button>
            <button className="btn btn-qris" onClick={() => setMethod("qris")}>QRIS</button>
          </div>
        )}

        {/* Step 2a: Cash — input uang */}
        {method === "cash" && (
          <div className="cash-input-section">
            <label htmlFor="cashGiven">Uang Diterima (Rp)</label>
            <input id="cashGiven" type="number" min={total} step="1000"
              placeholder={String(total)}
              value={cashGiven}
              onChange={(e) => setCashGiven(e.target.value)}
              disabled={localLoading}
              autoFocus
            />
            {Number.isFinite(cashNum) && cashNum >= total && (
              <div className="change-display">Kembalian: <strong>{formatRupiah(change)}</strong></div>
            )}
            {Number.isFinite(cashNum) && cashNum > 0 && cashNum < total && (
              <div className="change-display txt-out">Uang kurang {formatRupiah(total - cashNum)}</div>
            )}
          </div>
        )}

        {/* Step 2b: QRIS statis */}
        {method === "qris" && (
          <div className="qris-section">
            {qrisImage && (
              <div className="qris-preview">
                <img src={qrisImage} alt="QRIS Statis" className="qris-image" />
                <p className="small-text">Scan QRIS di atas untuk bayar <strong>{formatRupiah(total)}</strong></p>
              </div>
            )}
            {qrisStatus && <p className="small-text">{qrisStatus}</p>}
            {qrisError && <p className="txt-out">{qrisError}</p>}
          </div>
        )}

        {/* Actions */}
        {method !== null && (
          <div className="modal-actions">
            <button className="btn btn-secondary" onClick={() => { setMethod(null); resetQrisState(); }} disabled={localLoading}>
              ← Ganti Metode
            </button>
            {method === "cash" && (
              <button className="btn btn-bayar" disabled={!canProcessCash || localLoading}
                onClick={() => onPay("cash", cashGiven)}>
                Proses Pembayaran
              </button>
            )}
            {method === "qris" && qrisReady && (
              <>
                <button className="btn btn-secondary" disabled={localLoading}
                  onClick={handlePrintQris}>
                  Cetak QRIS
                </button>
                <button className="btn btn-bayar" disabled={localLoading}
                  onClick={confirmQrisPayment}>
                  Konfirmasi Pembayaran
                </button>
              </>
            )}
          </div>
        )}

        <button className="btn-close-modal" onClick={onClose} disabled={localLoading}>✕</button>
      </div>
    </div>
  );
}
