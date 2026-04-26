import { useEffect, useState } from "react";

export default function DatabaseSettings({ onApplied }) {
  const [dbConfig, setDbConfig] = useState({
    host: "",
    port: 3306,
    user: "",
    password: "",
    database: ""
  });

  const [currentConfig, setCurrentConfig] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  async function loadDatabaseConfig() {
    try {
      setLoading(true);
      setStatus("Memuat konfigurasi database...");
      const data = await window.posApi.getDatabaseConfig();
      
      if (data.config) {
        setCurrentConfig(data.config);
        setDbConfig(data.config);
        setIsConnected(data.isConnected || false);
        setStatus(data.isConnected ? "Terhubung ke database." : "Tidak terhubung ke database.");
      } else {
        setStatus("Belum ada konfigurasi database.");
      }
    } catch (err) {
      setStatus(`Gagal memuat konfigurasi: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDatabaseConfig();
  }, []);

  function handleInputChange(e) {
    const { name, value } = e.target;
    setDbConfig((prev) => ({
      ...prev,
      [name]: name === "port" ? Number(value) : value
    }));
  }

  async function testConnection() {
    if (!dbConfig.host || !dbConfig.user || !dbConfig.database) {
      setStatus("Host, User, dan Database harus diisi.");
      return;
    }

    try {
      setLoading(true);
      setStatus("Testing koneksi database...");
      const result = await window.posApi.testDatabaseConnection(dbConfig);
      
      if (result.success) {
        setStatus("✓ Koneksi database berhasil!");
        setIsConnected(true);
      } else {
        setStatus(`✗ Koneksi gagal: ${result.error}`);
        setIsConnected(false);
      }
    } catch (err) {
      setStatus(`✗ Error testing koneksi: ${err.message}`);
      setIsConnected(false);
    } finally {
      setLoading(false);
    }
  }

  async function saveDatabaseConfig() {
    if (!dbConfig.host || !dbConfig.user || !dbConfig.database) {
      setStatus("Host, User, dan Database harus diisi.");
      return;
    }

    try {
      setLoading(true);
      setStatus("Menyimpan konfigurasi database...");
      const result = await window.posApi.saveDatabaseConfig(dbConfig);
      
      setCurrentConfig(result.config);
      setStatus("✓ Konfigurasi database berhasil disimpan.");
      onApplied?.(result.config);
    } catch (err) {
      setStatus(`✗ Gagal menyimpan konfigurasi: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  async function clearDatabaseConfig() {
    if (!confirm("Yakin ingin menghapus konfigurasi database? Data tetap ada di JSON file.")) {
      return;
    }

    try {
      setLoading(true);
      setStatus("Menghapus konfigurasi database...");
      await window.posApi.clearDatabaseConfig();
      
      setCurrentConfig(null);
      setDbConfig({
        host: "",
        port: 3306,
        user: "",
        password: "",
        database: ""
      });
      setIsConnected(false);
      setStatus("✓ Konfigurasi database berhasil dihapus. Sistem kembali ke penyimpanan JSON file.");
    } catch (err) {
      setStatus(`✗ Gagal menghapus konfigurasi: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="panel database-panel">
      <div className="printer-header-row">
        <h2>Konfigurasi Database MySQL</h2>
        <div>
          <span
            className={`status-badge ${isConnected ? "connected" : "disconnected"}`}
          >
            {isConnected ? "✓ Terhubung" : "✗ Tidak Terhubung"}
          </span>
        </div>
      </div>

      <p className="small-text">
        Jika konfigurasi database diatur, semua data transaksi dan order akan disimpan ke database MySQL.
        Jika tidak ada konfigurasi, data tetap disimpan di file JSON.
      </p>

      <div className="database-form-group">
        <label htmlFor="dbHost">Host/Server</label>
        <input
          id="dbHost"
          type="text"
          name="host"
          placeholder="localhost / 192.168.1.10"
          value={dbConfig.host}
          onChange={handleInputChange}
          disabled={loading}
          className="form-input"
        />
      </div>

      <div className="form-row">
        <div className="database-form-group">
          <label htmlFor="dbPort">Port</label>
          <input
            id="dbPort"
            type="number"
            name="port"
            value={dbConfig.port}
            onChange={handleInputChange}
            disabled={loading}
            className="form-input"
          />
        </div>

        <div className="database-form-group">
          <label htmlFor="dbUser">User</label>
          <input
            id="dbUser"
            type="text"
            name="user"
            placeholder="root / dbuser"
            value={dbConfig.user}
            onChange={handleInputChange}
            disabled={loading}
            className="form-input"
          />
        </div>
      </div>

      <div className="form-row">
        <div className="database-form-group">
          <label htmlFor="dbPassword">Password</label>
          <div className="password-input-wrapper">
            <input
              id="dbPassword"
              type={showPassword ? "text" : "password"}
              name="password"
              placeholder="Password database"
              value={dbConfig.password}
              onChange={handleInputChange}
              disabled={loading}
              className="form-input"
            />
            <button
              type="button"
              className="btn-toggle-password"
              onClick={() => setShowPassword(!showPassword)}
              disabled={loading}
            >
              {showPassword ? "Sembunyikan" : "Tampilkan"}
            </button>
          </div>
        </div>

        <div className="database-form-group">
          <label htmlFor="dbDatabase">Database</label>
          <input
            id="dbDatabase"
            type="text"
            name="database"
            placeholder="pos_db / barangmudo"
            value={dbConfig.database}
            onChange={handleInputChange}
            disabled={loading}
            className="form-input"
          />
        </div>
      </div>

      <div className="database-current-box">
        <strong>Konfigurasi Saat Ini:</strong>
        {currentConfig ? (
          <div className="config-info">
            <p>
              {currentConfig.user}@{currentConfig.host}:{currentConfig.port}/{currentConfig.database}
            </p>
          </div>
        ) : (
          <p className="text-muted">Belum ada konfigurasi database</p>
        )}
      </div>

      <div className="database-actions-row">
        <button
          className="btn btn-secondary"
          onClick={testConnection}
          disabled={loading || !dbConfig.host}
        >
          Test Koneksi
        </button>
        <button
          className="btn btn-save"
          onClick={saveDatabaseConfig}
          disabled={loading}
        >
          Simpan Konfigurasi
        </button>
        {currentConfig && (
          <button
            className="btn btn-danger"
            onClick={clearDatabaseConfig}
            disabled={loading}
          >
            Hapus Konfigurasi
          </button>
        )}
      </div>

      <div className={`status ${status.includes("✓") ? "success" : status.includes("✗") ? "error" : ""}`}>
        {status}
      </div>

      <div className="database-info-box">
        <h4>ℹ️ Informasi</h4>
        <ul className="small-text">
          <li>Schema database akan otomatis dibuat saat koneksi pertama berhasil.</li>
          <li>Tabel yang dibuat: <code>transactions</code>, <code>orders</code>, <code>order_items</code></li>
          <li>Data lama di file JSON tidak akan dihapus, hanya akan menggunakan database ke depannya.</li>
          <li>Jika ingin kembali ke JSON file, hapus konfigurasi database ini.</li>
        </ul>
      </div>
    </section>
  );
}
