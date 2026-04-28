import { useEffect, useMemo, useState } from "react";
import CustomOrder from "./CustomOrder";
import PrinterSettings from "./PrinterSettings";
import DatabaseSettings from "./DatabaseSettings";
import AccountSettings from "./AccountSettings";

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

function emptySummary() {
  return { totalIn: 0, totalOut: 0, balance: 0 };
}

function emptyOrderSummary() {
  return { totalSales: 0, totalOrders: 0, totalCash: 0, totalQris: 0, totalReturned: 0 };
}

export default function App() {
  const [tab, setTab] = useState("order");

  // -- Auth state --
  const [authLoading, setAuthLoading] = useState(true);
  const [authStatus, setAuthStatus] = useState("");
  const [authState, setAuthState] = useState({
    enabled: false,
    needsSetup: true,
    user: null,
    permissions: {},
    roles: []
  });

  const [setupForm, setSetupForm] = useState({
    username: "admin",
    displayName: "Owner",
    password: "",
    role: "admin"
  });

  const [loginForm, setLoginForm] = useState({
    username: "",
    password: ""
  });

  const [selfPassword, setSelfPassword] = useState({
    currentPassword: "",
    newPassword: ""
  });

  // -- Kasir state --
  const [nominal, setNominal] = useState("");
  const [description, setDescription] = useState("");
  const [transactions, setTransactions] = useState([]);
  const [summary, setSummary] = useState(emptySummary());
  const [printer, setPrinter] = useState(null);
  const [status, setStatus] = useState("Siap.");
  const [loading, setLoading] = useState(false);

  // -- Order state --
  const [orders, setOrders] = useState([]);
  const [orderSummary, setOrderSummary] = useState(emptyOrderSummary());

  const nominalNumber = useMemo(() => Number(nominal), [nominal]);
  const permissions = authState.permissions || {};

  const can = (key) => permissions[key] === true;

  const availableTabs = useMemo(() => {
    const tabs = [];
    if (can("view_order")) tabs.push({ key: "order", label: "Order Katalog" });
    if (can("view_kasir")) tabs.push({ key: "kasir", label: "Kasir Cash" });
    if (can("view_printer")) tabs.push({ key: "printer", label: "Printer" });
    if (can("view_database")) tabs.push({ key: "database", label: "Database" });
    if (can("manage_accounts")) tabs.push({ key: "accounts", label: "Akun" });
    return tabs;
  }, [permissions]);

  useEffect(() => {
    if (availableTabs.length === 0) return;
    const isCurrentTabAllowed = availableTabs.some((item) => item.key === tab);
    if (!isCurrentTabAllowed) {
      setTab(availableTabs[0].key);
    }
  }, [availableTabs, tab]);

  async function loadBootstrap() {
    const data = await window.posApi.getBootstrap();
    setTransactions(data.transactions || []);
    setSummary(data.summary || emptySummary());
    setPrinter(data.printer || null);
  }

  async function loadOrders() {
    const data = await window.posApi.getOrders();
    setOrders(data.orders || []);
    setOrderSummary(data.summary || emptyOrderSummary());
  }

  async function loadDataForPermissions(nextPermissions) {
    try {
      if (nextPermissions.view_kasir) {
        await loadBootstrap();
      } else {
        setTransactions([]);
        setSummary(emptySummary());
      }

      if (nextPermissions.view_order) {
        await loadOrders();
      } else {
        setOrders([]);
        setOrderSummary(emptyOrderSummary());
      }
    } catch (err) {
      setStatus(`Gagal memuat data: ${err.message}`);
    }
  }

  async function refreshAuthState() {
    const state = await window.posApi.getAuthState();
    setAuthState(state);
    return state;
  }

  useEffect(() => {
    async function init() {
      try {
        const state = await refreshAuthState();
        if (state.user) {
          await loadDataForPermissions(state.permissions || {});
        }
      } catch (err) {
        setAuthStatus(`Gagal memuat status auth: ${err.message}`);
      } finally {
        setAuthLoading(false);
      }
    }

    init().catch(() => {});
  }, []);

  async function handleSetupInitialAccount(e) {
    e.preventDefault();
    setAuthStatus("");

    try {
      const result = await window.posApi.setupInitialAccount(setupForm);
      setAuthState(result.state);
      setLoginForm({ username: "", password: "" });
      await loadDataForPermissions(result.state.permissions || {});
      setAuthStatus(result.message || "Akun awal berhasil dibuat.");
    } catch (err) {
      setAuthStatus(`Setup akun gagal: ${err.message}`);
    }
  }

  async function handleLogin(e) {
    e.preventDefault();
    setAuthStatus("");

    try {
      const result = await window.posApi.login(loginForm);
      setAuthState(result.state);
      setLoginForm({ username: "", password: "" });
      await loadDataForPermissions(result.state.permissions || {});
      setAuthStatus(result.message || "Login berhasil.");
    } catch (err) {
      setAuthStatus(`Login gagal: ${err.message}`);
    }
  }

  async function handleLogout() {
    try {
      const result = await window.posApi.logout();
      setAuthState(result.state);
      setTransactions([]);
      setSummary(emptySummary());
      setOrders([]);
      setOrderSummary(emptyOrderSummary());
      setStatus("Siap.");
      setAuthStatus(result.message || "Logout berhasil.");
    } catch (err) {
      setAuthStatus(`Logout gagal: ${err.message}`);
    }
  }

  async function handleSelfPasswordChange(e) {
    e.preventDefault();

    if (!selfPassword.newPassword.trim()) {
      setAuthStatus("Password baru wajib diisi.");
      return;
    }

    try {
      const result = await window.posApi.changeAccountPassword({
        currentPassword: selfPassword.currentPassword,
        newPassword: selfPassword.newPassword
      });
      setSelfPassword({ currentPassword: "", newPassword: "" });
      setAuthStatus(result.message || "Password berhasil diubah.");
    } catch (err) {
      setAuthStatus(`Ganti password gagal: ${err.message}`);
    }
  }

  async function submitTransaction(type) {
    if (!Number.isFinite(nominalNumber) || nominalNumber <= 0) {
      setStatus("Nominal harus angka dan lebih dari 0.");
      return;
    }

    if (!can("create_transaction")) {
      setStatus("Akun tidak punya akses buat transaksi kasir.");
      return;
    }

    try {
      setLoading(true);
      setStatus("Menyimpan transaksi...");
      const result = await window.posApi.addTransaction({
        type,
        nominal: nominalNumber,
        description,
        autoPrint: true
      });
      setTransactions(result.transactions || []);
      setSummary(result.summary || emptySummary());
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
    if (!can("print_receipt")) {
      setStatus("Akun tidak punya akses cetak struk.");
      return;
    }

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

  if (authLoading) {
    return (
      <main className="app-shell">
        <section className="panel auth-panel">
          <h2>Memuat Sistem Akses...</h2>
          <p className="small-text">Sedang memeriksa status akun dan role akses.</p>
        </section>
      </main>
    );
  }

  if (authState.needsSetup) {
    return (
      <main className="app-shell">
        <section className="panel auth-panel">
          <h2>Setup Akun Awal</h2>
          <p className="small-text">
            Belum ada akun. Buat akun pertama untuk mengaktifkan login dan role akses.
          </p>

          <form className="account-create-form" onSubmit={handleSetupInitialAccount}>
            <div className="form-row">
              <div className="database-form-group">
                <label htmlFor="setup-username">Username</label>
                <input
                  id="setup-username"
                  value={setupForm.username}
                  onChange={(e) => setSetupForm((prev) => ({ ...prev, username: e.target.value }))}
                />
              </div>
              <div className="database-form-group">
                <label htmlFor="setup-displayname">Nama Tampilan</label>
                <input
                  id="setup-displayname"
                  value={setupForm.displayName}
                  onChange={(e) => setSetupForm((prev) => ({ ...prev, displayName: e.target.value }))}
                />
              </div>
            </div>

            <div className="form-row">
              <div className="database-form-group">
                <label htmlFor="setup-password">Password</label>
                <input
                  id="setup-password"
                  type="password"
                  value={setupForm.password}
                  onChange={(e) => setSetupForm((prev) => ({ ...prev, password: e.target.value }))}
                  placeholder="minimal 6 karakter"
                />
              </div>
              <div className="database-form-group">
                <label htmlFor="setup-role">Role</label>
                <select
                  id="setup-role"
                  className="printer-select"
                  value={setupForm.role}
                  onChange={(e) => setSetupForm((prev) => ({ ...prev, role: e.target.value }))}
                >
                  <option value="admin">Admin</option>
                  <option value="cashier">Kasir</option>
                </select>
              </div>
            </div>

            <button type="submit" className="btn btn-save">Simpan Akun Awal</button>
          </form>

          {authStatus && <div className="status">{authStatus}</div>}
        </section>
      </main>
    );
  }

  if (!authState.user) {
    return (
      <main className="app-shell">
        <section className="panel auth-panel">
          <h2>Login Akun</h2>
          <p className="small-text">Masukkan username dan password untuk masuk ke aplikasi POS.</p>

          <form className="account-login-form" onSubmit={handleLogin}>
            <div className="database-form-group">
              <label htmlFor="login-username">Username</label>
              <input
                id="login-username"
                value={loginForm.username}
                onChange={(e) => setLoginForm((prev) => ({ ...prev, username: e.target.value }))}
              />
            </div>

            <div className="database-form-group">
              <label htmlFor="login-password">Password</label>
              <input
                id="login-password"
                type="password"
                value={loginForm.password}
                onChange={(e) => setLoginForm((prev) => ({ ...prev, password: e.target.value }))}
              />
            </div>

            <button type="submit" className="btn btn-save">Login</button>
          </form>

          {authStatus && <div className="status">{authStatus}</div>}
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <section className="panel auth-user-panel">
        <div>
          <h3>
            Login sebagai: {authState.user.displayName || authState.user.username}
          </h3>
          <p className="small-text">
            Username: <span className="mono">{authState.user.username}</span> | Role: {authState.user.role}
          </p>
        </div>

        <div className="auth-user-actions">
          <button className="btn btn-secondary" onClick={handleLogout}>Logout</button>
        </div>

        <form className="self-password-form" onSubmit={handleSelfPasswordChange}>
          <div className="database-form-group">
            <label htmlFor="self-current-password">Password Saat Ini</label>
            <input
              id="self-current-password"
              type="password"
              value={selfPassword.currentPassword}
              onChange={(e) => setSelfPassword((prev) => ({ ...prev, currentPassword: e.target.value }))}
              placeholder="wajib untuk kasir"
            />
          </div>
          <div className="database-form-group">
            <label htmlFor="self-new-password">Password Baru</label>
            <input
              id="self-new-password"
              type="password"
              value={selfPassword.newPassword}
              onChange={(e) => setSelfPassword((prev) => ({ ...prev, newPassword: e.target.value }))}
              placeholder="minimal 6 karakter"
            />
          </div>
          <button type="submit" className="btn btn-save">Ubah Password Saya</button>
        </form>

        {authStatus && <div className="status">{authStatus}</div>}
      </section>

      <nav className="tab-bar">
        {availableTabs.map((item) => (
          <button
            key={item.key}
            className={`tab-btn ${tab === item.key ? "tab-active" : ""}`}
            onClick={() => setTab(item.key)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {tab === "order" && can("view_order") && (
        <CustomOrder
          orders={orders}
          summary={orderSummary}
          onRefresh={loadOrders}
          canCreateOrder={can("create_order")}
          canRetur={can("retur_order")}
        />
      )}

      {tab === "kasir" && can("view_kasir") && (
        <>
          <section className="panel form-panel">
            <h1>POS Kasir Desktop</h1>
            <p className="small-text">Input transaksi cash harian dan cetak ke thermal printer.</p>

            <label htmlFor="nominal">Nominal (Rupiah)</label>
            <input
              id="nominal"
              type="number"
              min="0"
              step="100"
              placeholder="Contoh: 50000"
              value={nominal}
              onChange={(e) => setNominal(e.target.value)}
              disabled={loading || !can("create_transaction")}
            />

            <label htmlFor="description">Deskripsi Transaksi</label>
            <input
              id="description"
              type="text"
              placeholder="Contoh: Penjualan kopi"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={loading || !can("create_transaction")}
            />

            <div className="btn-row">
              <button
                className="btn btn-in"
                onClick={() => submitTransaction("in")}
                disabled={loading || !can("create_transaction")}
              >
                Uang Masuk
              </button>
              <button
                className="btn btn-out"
                onClick={() => submitTransaction("out")}
                disabled={loading || !can("create_transaction")}
              >
                Uang Keluar
              </button>
            </div>

            <button
              className="btn btn-print"
              onClick={printLastReceipt}
              disabled={loading || !can("print_receipt")}
            >
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

      {tab === "printer" && can("view_printer") && (
        <PrinterSettings onApplied={(cfg) => setPrinter(cfg || null)} />
      )}

      {tab === "database" && can("view_database") && (
        <DatabaseSettings onApplied={() => {}} />
      )}

      {tab === "accounts" && can("manage_accounts") && (
        <AccountSettings
          currentUser={authState.user}
          onAuthStateChanged={(nextState) => setAuthState(nextState)}
        />
      )}
    </main>
  );
}
