import { useEffect, useState } from "react";
import QRCode from "qrcode";

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
  const [qrisSession, setQrisSession] = useState(null);
  const [qrisImage, setQrisImage] = useState("");
  const [qrisStatus, setQrisStatus] = useState("");
  const [qrisError, setQrisError] = useState("");
  const [qrisBusy, setQrisBusy] = useState(false);

  const cashNum = Number(cashGiven);
  const change = Number.isFinite(cashNum) ? cashNum - total : 0;
  const canProcessCash = method === "cash" && Number.isFinite(cashNum) && cashNum >= total;
  const isWaitingQris = method === "qris" && Boolean(qrisSession);
  const localLoading = loading || qrisBusy;

  useEffect(() => {
    let active = true;

    async function buildQrisImage() {
      if (!qrisSession?.qrContent) {
        setQrisImage("");
        return;
      }

      try {
        const url = await QRCode.toDataURL(qrisSession.qrContent, {
          margin: 1,
          width: 260
        });
        if (active) {
          setQrisImage(url);
        }
      } catch {
        if (active) {
          setQrisImage("");
        }
      }
    }

    buildQrisImage();
    return () => {
      active = false;
    };
  }, [qrisSession]);

  useEffect(() => {
    if (!isWaitingQris || !qrisSession) {
      return undefined;
    }

    const timer = setInterval(async () => {
      try {
        const check = await window.posApi.checkQrisPayment({
          partnerReferenceNo: qrisSession.partnerReferenceNo,
          referenceNo: qrisSession.referenceNo
        });

        if (check.paid) {
          clearInterval(timer);
          setQrisBusy(true);
          setQrisStatus("Pembayaran terdeteksi. Menyimpan order...");
          await onPay("qris", null, {
            paid: true,
            partnerReferenceNo: qrisSession.partnerReferenceNo,
            referenceNo: qrisSession.referenceNo,
            paidTime: check.paidTime,
            latestTransactionStatus: check.latestTransactionStatus,
            transactionStatusDesc: check.transactionStatusDesc,
            approvalCode: check.approvalCode
          });
          return;
        }

        if (check.failed) {
          clearInterval(timer);
          setQrisError(`Pembayaran QRIS gagal/expired (${check.transactionStatusDesc || check.latestTransactionStatus}).`);
          setQrisStatus("");
          return;
        }

        setQrisStatus(`Menunggu pembayaran... ${check.transactionStatusDesc || "Pending"}`);
      } catch (err) {
        setQrisError(`Cek status QRIS gagal: ${err.message}`);
      }
    }, 4000);

    return () => clearInterval(timer);
  }, [isWaitingQris, onPay, qrisSession]);

  function resetQrisState() {
    setQrisSession(null);
    setQrisImage("");
    setQrisStatus("");
    setQrisError("");
    setQrisBusy(false);
  }

  async function startQrisPayment() {
    try {
      setQrisBusy(true);
      setQrisError("");
      setQrisStatus("Membuat QRIS dinamis...");

      const session = await window.posApi.startQrisPayment({ amount: total });
      setQrisSession(session);
      setQrisStatus("QRIS siap. Menunggu pembayaran...");

      if (session.printResult?.message) {
        setQrisStatus((prev) => `${prev} ${session.printResult.message}`);
      }
    } catch (err) {
      setQrisError(`Gagal membuat QRIS: ${err.message}`);
      setQrisStatus("");
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

        {/* Step 2b: QRIS — info */}
        {method === "qris" && (
          <div className="qris-section">
            {!qrisSession && <p>Klik <strong>Proses Pembayaran</strong> untuk generate QRIS dinamis dari DOKU.</p>}
            {qrisSession && (
              <div className="qris-preview">
                {qrisImage ? (
                  <img src={qrisImage} alt="QRIS Dinamis" className="qris-image" />
                ) : (
                  <p className="small-text">Memproses tampilan QR...</p>
                )}
                <p className="small-text">Ref: {qrisSession.partnerReferenceNo}</p>
                {qrisSession.validityPeriod && (
                  <p className="small-text">Berlaku sampai: {new Date(qrisSession.validityPeriod).toLocaleString("id-ID")}</p>
                )}
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
            {method === "qris" && !qrisSession && (
              <button className="btn btn-bayar" disabled={localLoading}
                onClick={startQrisPayment}>
                Proses Pembayaran
              </button>
            )}
          </div>
        )}

        <button className="btn-close-modal" onClick={onClose} disabled={localLoading}>✕</button>
      </div>
    </div>
  );
}
