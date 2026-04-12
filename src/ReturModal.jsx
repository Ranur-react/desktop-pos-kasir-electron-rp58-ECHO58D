import { useState } from "react";

function formatRupiah(value) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0
  }).format(Number(value || 0));
}

export default function ReturModal({ order, line, loading, onRetur, onClose }) {
  const [reason, setReason] = useState("");

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Retur Item</h2>
        <p>Order: <strong>{order.id}</strong></p>
        <p>Barang: <strong>{line.title}</strong></p>
        <p>{line.qty} x {formatRupiah(line.price)} = {formatRupiah(line.lineTotal)}</p>

        <label htmlFor="returReason">Alasan Retur (opsional)</label>
        <input id="returReason" type="text" placeholder="Contoh: Barang rusak"
          value={reason} onChange={(e) => setReason(e.target.value)} disabled={loading} />

        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onClose} disabled={loading}>Batal</button>
          <button className="btn btn-out" disabled={loading}
            onClick={() => onRetur(order.id, line.lineId, reason)}>
            Konfirmasi Retur
          </button>
        </div>

        <button className="btn-close-modal" onClick={onClose}>✕</button>
      </div>
    </div>
  );
}
