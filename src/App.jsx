import { useEffect, useMemo, useRef, useState } from "react";
import CustomOrder from "./CustomOrder";
import PrinterSettings from "./PrinterSettings";
import DatabaseSettings from "./DatabaseSettings";
import AccountSettings from "./AccountSettings";
import StoreSettings from "./StoreSettings";

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

function isTypingElement(target) {
  if (!target) return false;
  const tag = String(target.tagName || "").toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable === true;
}

export default function App() {
  const [tab, setTab] = useState("order");
  const [licenseState, setLicenseState] = useState({
    isWriteEnabled: false,
    mode: "read-only",
    reason: "Memeriksa status lisensi...",
    readOnlyMessage: "",
    developerContact: {}
  });

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

  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);

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
  const readOnlyByLicense = licenseState?.isWriteEnabled !== true;

  const nominalInputRef = useRef(null);
  const descInputRef = useRef(null);

  const can = (key) => permissions[key] === true;

  const availableTabs = useMemo(() => {
    const tabs = [];
    if (can("view_order")) tabs.push({ key: "order", label: "Order Katalog", icon: "🛒" });
    if (can("view_kasir")) tabs.push({ key: "kasir", label: "Kasir Cash", icon: "💵" });
    if (can("manage_printer")) tabs.push({ key: "store", label: "Toko", icon: "⚙️" });
    if (!readOnlyByLicense && can("view_printer")) tabs.push({ key: "printer", label: "Printer", icon: "🖨" });
    if (!readOnlyByLicense && can("view_database")) tabs.push({ key: "database", label: "Database", icon: "🗄" });
    if (!readOnlyByLicense && can("manage_accounts")) tabs.push({ key: "accounts", label: "Akun", icon: "👥" });
    return tabs;
  }, [permissions, readOnlyByLicense]);

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

  async function refreshLicenseState() {
    try {
      const next = await window.posApi.getLicenseState();
      setLicenseState(next);
      return next;
    } catch (err) {
      setLicenseState((prev) => ({
        ...prev,
        isWriteEnabled: false,
        mode: "read-only",
        reason: `Gagal memuat lisensi: ${err.message}`
      }));
      return null;
    }
  }

  useEffect(() => {
    async function init() {
      try {
        await refreshLicenseState();
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

  useEffect(() => {
    function onGlobalKeydown(e) {
      if (!authState.user) return;
      if (tab !== "kasir") return;

      const typing = isTypingElement(e.target);
      const key = e.key.toLowerCase();

      if (e.key === "F2") {
        e.preventDefault();
        nominalInputRef.current?.focus();
        return;
      }

      if (e.key === "F3") {
        e.preventDefault();
        descInputRef.current?.focus();
        return;
      }

      if (typing && !(e.ctrlKey || e.metaKey)) return;

      if ((e.ctrlKey || e.metaKey) && key === "i") {
        e.preventDefault();
        submitTransaction("in");
      }

      if ((e.ctrlKey || e.metaKey) && key === "u") {
        e.preventDefault();
        submitTransaction("out");
      }

      if ((e.ctrlKey || e.metaKey) && key === "p") {
        e.preventDefault();
        printLastReceipt();
      }
    }

    window.addEventListener("keydown", onGlobalKeydown);
    return () => window.removeEventListener("keydown", onGlobalKeydown);
  }, [authState.user, tab, nominalNumber, description, loading, permissions, readOnlyByLicense, licenseState?.readOnlyMessage]);

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
      setTimeout(() => setAuthStatus(""), 3000);
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
      setShowProfileMenu(false);
      setShowPasswordModal(false);
      setTimeout(() => setAuthStatus(""), 3000);
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
      setShowPasswordModal(false);
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

    if (readOnlyByLicense) {
      setStatus(licenseState?.readOnlyMessage || "Lisensi tidak aktif. Mode baca saja.");
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

    if (readOnlyByLicense) {
      setStatus(licenseState?.readOnlyMessage || "Lisensi tidak aktif. Mode baca saja.");
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
      <main className="app-shell auth-shell">
        <section className="panel auth-panel">
          <h2>Memuat Sistem Akses...</h2>
          <p className="small-text">Sedang memeriksa status akun dan role akses.</p>
        </section>
      </main>
    );
  }

  if (authState.needsSetup) {
    return (
      <main className="app-shell auth-shell">
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

            <button type="submit" className="btn btn-save" disabled={readOnlyByLicense}>Simpan Akun Awal</button>
          </form>

          {readOnlyByLicense && (
            <p className="small-text" style={{ color: "#b42318", marginTop: "8px" }}>
              Setup akun dinonaktifkan saat license tidak aktif (mode read-only).
            </p>
          )}

          {authStatus && <div className="status">{authStatus}</div>}
        </section>
      </main>
    );
  }

  if (!authState.user) {
    return (
      <main className="app-shell auth-shell">
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
    <main className="app-shell dashboard-shell">
      <header className="dashboard-topbar panel">
        <div className="topbar-brand">
          <h1>Barangmudo POS</h1>
          <p className="small-text">Operasional Kasir Harian</p>
        </div>

        <div className="topbar-actions">
          <div className="profile-menu-wrap">
            <button
              className="top-icon-btn profile-btn"
              type="button"
              title="Menu Profil"
              onClick={() => setShowProfileMenu((v) => !v)}
            >
              <span className="profile-name-display">{authState.user.displayName || authState.user.username}</span>
              👤
            </button>

            {showProfileMenu && (
              <div className="profile-dropdown panel">
                <div className="profile-dropdown-head">
                  <strong>{authState.user.displayName || authState.user.username}</strong>
                  <p className="small-text">{authState.user.role}</p>
                </div>
                <button
                  className="profile-item-btn"
                  onClick={() => {
                    setShowProfileMenu(false);
                    setShowPasswordModal(true);
                  }}
                >
                  Ubah Password
                </button>
                <button className="profile-item-btn profile-logout-btn" onClick={handleLogout}>
                  Logout
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {readOnlyByLicense && (
        <section className="panel license-banner-panel">
          <h3>Mode Read-Only</h3>
          <p className="small-text" style={{ marginBottom: "6px" }}>
            {licenseState?.readOnlyMessage || "Lisensi tidak aktif. Aplikasi dibatasi ke mode baca saja."}
          </p>
          <p className="small-text" style={{ marginBottom: 0 }}>
            Status: {licenseState?.reason || "-"} | Hubungi developer: {licenseState?.developerContact?.email || "-"} | {licenseState?.developerContact?.whatsapp || "-"}
          </p>
        </section>
      )}

      <nav className="tab-bar dashboard-nav panel">
        {availableTabs.map((item) => (
          <button
            key={item.key}
            className={`tab-btn ${tab === item.key ? "tab-active" : ""}`}
            onClick={() => setTab(item.key)}
          >
            <span className="tab-icon">{item.icon}</span>
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      {tab === "order" && can("view_order") && (
        <CustomOrder
          orders={orders}
          summary={orderSummary}
          onRefresh={loadOrders}
          canCreateOrder={can("create_order") && !readOnlyByLicense}
          canRetur={can("retur_order") && !readOnlyByLicense}
        />
      )}

      {tab === "kasir" && can("view_kasir") && (
        <>
          <section className="panel kasir-shortcuts-panel">
            <h3>Shortcut Kasir</h3>
            <p className="small-text">F2: Nominal | F3: Deskripsi | Ctrl+I: Uang Masuk | Ctrl+U: Uang Keluar | Ctrl+P: Cetak Struk</p>
          </section>

          <section className="panel form-panel">
            <h2>POS Kasir Cash</h2>
            <p className="small-text">Input transaksi cash harian dan cetak ke thermal printer.</p>

            <label htmlFor="nominal">Nominal (Rupiah)</label>
            <input
              ref={nominalInputRef}
              id="nominal"
              type="number"
              min="0"
              step="100"
              placeholder="Contoh: 50000"
              value={nominal}
              onChange={(e) => setNominal(e.target.value)}
              disabled={loading || !can("create_transaction") || readOnlyByLicense}
            />

            <label htmlFor="description">Deskripsi Transaksi</label>
            <input
              ref={descInputRef}
              id="description"
              type="text"
              placeholder="Contoh: Penjualan kopi"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={loading || !can("create_transaction") || readOnlyByLicense}
            />

            <div className="btn-row">
              <button
                className="btn btn-in"
                onClick={() => submitTransaction("in")}
                disabled={loading || !can("create_transaction") || readOnlyByLicense}
              >
                Uang Masuk
              </button>
              <button
                className="btn btn-out"
                onClick={() => submitTransaction("out")}
                disabled={loading || !can("create_transaction") || readOnlyByLicense}
              >
                Uang Keluar
              </button>
            </div>

            <button
              className="btn btn-print"
              onClick={printLastReceipt}
              disabled={loading || !can("print_receipt") || readOnlyByLicense}
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

      {tab === "store" && can("manage_printer") && (
        <StoreSettings
          onApplied={() => {}}
          licenseState={licenseState}
          onLicenseStateChanged={setLicenseState}
          appReadOnly={readOnlyByLicense}
        />
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

      {showPasswordModal && (
        <div className="modal-overlay" onClick={() => setShowPasswordModal(false)}>
          <section className="modal password-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Ubah Password</h2>
            <p className="small-text">Akun: {authState.user.username}</p>

            <form className="password-modal-form" onSubmit={handleSelfPasswordChange}>
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

              <div className="password-modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowPasswordModal(false)}>
                  Batal
                </button>
                <button type="submit" className="btn btn-save" disabled={readOnlyByLicense}>Simpan Password</button>
              </div>
            </form>

            {readOnlyByLicense && (
              <p className="small-text" style={{ color: "#b42318", marginTop: "8px" }}>
                Ubah password dinonaktifkan saat mode read-only aktif.
              </p>
            )}
          </section>
        </div>
      )}

      {authStatus && <div className="floating-status panel">{authStatus}</div>}
    </main>
  );
}
