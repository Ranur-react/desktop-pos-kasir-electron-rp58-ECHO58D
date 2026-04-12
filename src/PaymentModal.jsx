import { useState } from "react";

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

  const cashNum = Number(cashGiven);
  const change = Number.isFinite(cashNum) ? cashNum - total : 0;
  const canProcess =
    method === "qris" ||
    (method === "cash" && Number.isFinite(cashNum) && cashNum >= total);

  return (
    <div className="modal-overlay" onClick={onClose}>
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
              disabled={loading}
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

        {/* Step 2b: QRIS — info */}
        {method === "qris" && (
          <div className="qris-section">
            <p>Scan QRIS lalu klik <strong>Proses Pembayaran</strong>.</p>
          </div>
        )}

        {/* Actions */}
        {method !== null && (
          <div className="modal-actions">
            <button className="btn btn-secondary" onClick={() => setMethod(null)} disabled={loading}>
              ← Ganti Metode
            </button>
            <button className="btn btn-bayar" disabled={!canProcess || loading}
              onClick={() => onPay(method, cashGiven)}>
              Proses Pembayaran
            </button>
          </div>
        )}

        <button className="btn-close-modal" onClick={onClose}>✕</button>
      </div>
    </div>
  );
}
