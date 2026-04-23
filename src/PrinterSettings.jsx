import { useEffect, useState } from "react";

export default function PrinterSettings({ onApplied }) {
  const [printers, setPrinters] = useState([]);
  const [currentInterface, setCurrentInterface] = useState("");
  const [selectedInterface, setSelectedInterface] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");

  async function loadPrinters() {
    try {
      setLoading(true);
      setStatus("Memuat daftar printer...");
      const data = await window.posApi.listPrinters();
      setPrinters(data.printers || []);
      setCurrentInterface(data.current?.interface || "");
      setSelectedInterface(data.current?.interface || "");
      setStatus("Daftar printer siap.");
    } catch (err) {
      setStatus(`Gagal memuat printer: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadPrinters().catch(() => {});
  }, []);

  async function applyDefaultPrinter() {
    if (!selectedInterface) {
      setStatus("Pilih printer terlebih dahulu.");
      return;
    }

    try {
      setLoading(true);
      const res = await window.posApi.setDefaultPrinter({
        printerInterface: selectedInterface
      });
      setCurrentInterface(res.current?.interface || selectedInterface);
      setStatus("Default printer berhasil disimpan ke .env.");
      onApplied?.(res.current);
    } catch (err) {
      setStatus(`Gagal menyimpan default printer: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="panel printer-panel">
      <div className="printer-header-row">
        <h2>Konfigurasi Printer Thermal</h2>
        <button className="btn btn-secondary" onClick={loadPrinters} disabled={loading}>
          Refresh Printer List
        </button>
      </div>

      <p className="small-text">
        Pilih printer thermal default untuk cetak struk. Nilai akan disimpan ke file <code>.env</code> pada
        <code> PRINTER_INTERFACE</code>.
      </p>

      <div className="printer-current-box">
        <strong>Default saat ini:</strong> {currentInterface || "Belum diset"}
      </div>

      <label htmlFor="printerInterface">Pilih Printer</label>
      <select
        id="printerInterface"
        className="printer-select"
        value={selectedInterface}
        onChange={(e) => setSelectedInterface(e.target.value)}
        disabled={loading}
      >
        <option value="">-- Pilih printer --</option>
        {printers.map((p) => (
          <option key={p.interface} value={p.interface}>
            {p.name}
          </option>
        ))}
      </select>

      <div className="printer-actions-row">
        <button className="btn btn-save" onClick={applyDefaultPrinter} disabled={loading || !selectedInterface}>
          Simpan Sebagai Default
        </button>
      </div>

      <div className="status">{status}</div>
      <p className="small-text">
        Jika struk masih ke printer lama, tutup lalu buka kembali aplikasi agar semua sesi printer memakai setting
        terbaru.
      </p>
    </section>
  );
}
