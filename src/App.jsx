import { useEffect, useMemo, useRef, useState } from "react";
import CustomOrder from "./CustomOrder";
import PrinterSettings from "./PrinterSettings";
import DatabaseSettings from "./DatabaseSettings";
import ServerSettings from "./ServerSettings";
import AccountSettings from "./AccountSettings";
import StoreSettings from "./StoreSettings";
import ProductManagement from "./ProductManagement";

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

  // -- License input states --
  const [licenseInput, setLicenseInput] = useState("");
  const [licenseLoading, setLicenseLoading] = useState(false);
  const [licenseError, setLicenseError] = useState("");
  const [showLicenseScreen, setShowLicenseScreen] = useState(false);
  const [bypassLicenseReadOnly, setBypassLicenseReadOnly] = useState(false);

  // -- Auth state --
  const [authLoading, setAuthLoading] = useState(true);
  const [authSubmitting, setAuthSubmitting] = useState(false);
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
  const [showOrderSidebar, setShowOrderSidebar] = useState(false);

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
  const sidebarRef = useRef(null);
  const loginUsernameRef = useRef(null);

  const can = (key) => permissions[key] === true;

  const [serverStoreInfo, setServerStoreInfo] = useState(null);

  useEffect(() => {
    if (!authState.user && !authState.needsSetup) {
      const t = setTimeout(() => {
        loginUsernameRef.current?.focus();
      }, 50);
      return () => clearTimeout(t);
    }
  }, [authState.user, authState.needsSetup]);

  async function refreshServerBootstrap() {
    try {
      const res = await window.posApi.getServerBootstrap();
      if (res && res.status === "success") {
        setServerStoreInfo(res);
        if (res.store?.theme_color) {
          document.documentElement.style.setProperty("--brand-teal", res.store.theme_color);
          document.documentElement.style.setProperty("--accent-in", res.store.theme_color);
        }
      }
    } catch (e) {
      console.warn("Bootstrap server sync warning:", e.message);
    }
  }

  const mapNavIcon = (ic, fallback) => {
    if (!ic) return fallback;
    if (ic === "receipt" || ic === "order") return "🧾";
    if (ic === "cash" || ic === "kasir") return "💵";
    if (ic === "clipboard" || ic === "orders") return "📋";
    if (ic === "printer") return "🖨";
    return ic;
  };

  const availableTabs = useMemo(() => {
    const navItems = serverStoreInfo?.navigation || [];
    const getNavSetting = (key) =>
      navItems.find((n) => n.key === key || n.menu_key === key || n.route_path === key);

    const orderNav = getNavSetting("order");
    const kasirNav = getNavSetting("kasir");
    const ordersNav = getNavSetting("orders");
    const printerNav = getNavSetting("printer");

    const dynamicOrderLabel = orderNav?.label || "Order Katalog";
    const dynamicKasirLabel = kasirNav?.label || "Kasir Cash";
    const dynamicOrdersLabel = ordersNav?.label || "Riwayat Pesanan";
    const dynamicPrinterLabel = printerNav?.label || "Pengaturan Printer Struk";

    const isWebCashier = Boolean(
      authState.user && (
        authState.user.role === "cashier" ||
        authState.user.role_id === 3 ||
        (authState.user.isServerAccount && authState.user.role !== "admin")
      )
    );

    const isAdmin = Boolean(
      authState.user && (
        authState.user.role === "admin" ||
        authState.user.role_id === 1 ||
        authState.user.role_id === 2 ||
        (!authState.user.isServerAccount && authState.user.role === "admin")
      )
    );

    // Helper: Tentukan izin akses menu
    const isNavAllowed = (navItem, fallbackPermission) => {
      // Admin (baik lokal maupun online) selalu punya hak akses operasional
      if (isAdmin) return true;
      // Jika konfigurasi navigasi diterima dari server web:
      if (navItems.length > 0) {
        if (!navItem) return false;
        if (navItem.can_access !== undefined && !navItem.can_access) return false;
        if (navItem.is_active !== undefined && !navItem.is_active) return false;
        return true;
      }
      // Fallback offline / standalone
      return Boolean(fallbackPermission);
    };

    const tabs = [];

    // Tab Order Katalog / Mesin Kasir
    const allowOrder = isNavAllowed(orderNav, can("view_order"));
    if (allowOrder) {
      tabs.push({
        key: "order",
        label: dynamicOrderLabel,
        icon: mapNavIcon(orderNav?.icon, "🧾"),
        title: "" // title POS Order Katalog dihilangkan untuk hemat ruang
      });
    }

    // Tab Kasir Cash Cepat
    const allowKasir = isNavAllowed(kasirNav, can("view_kasir"));
    if (allowKasir) {
      tabs.push({
        key: "kasir",
        label: dynamicKasirLabel,
        icon: mapNavIcon(kasirNav?.icon, "💵"),
        title: "Sistem POS Kasir Cash"
      });
    }

    // Tab Riwayat Pesanan (jika aktif di navigasi server)
    const allowOrders = isNavAllowed(ordersNav, can("view_order"));
    if (ordersNav && allowOrders) {
      tabs.push({
        key: "orders",
        label: dynamicOrdersLabel,
        icon: mapNavIcon(ordersNav?.icon, "📋"),
        title: "Riwayat Transaksi & Pesanan"
      });
    }

    // Tab teknis produk / toko (khusus non-cashier)
    if (!isWebCashier) {
      if (can("view_product") || can("manage_product")) {
        tabs.push({ key: "products", label: "Produk (NEW)", icon: "📦", title: "Manajemen Produk & Inventori" });
      }
      if (can("manage_printer")) {
        tabs.push({ key: "store", label: "Toko", icon: "🏬", title: "Konfigurasi & Pengaturan Toko" });
      }
    }

    // Tab Printer Struk
    const allowPrinter = isNavAllowed(printerNav, !readOnlyByLicense && can("view_printer"));
    if (allowPrinter && !readOnlyByLicense) {
      tabs.push({
        key: "printer",
        label: dynamicPrinterLabel,
        icon: mapNavIcon(printerNav?.icon, "🖨"),
        title: dynamicPrinterLabel
      });
    }

    // Tab teknis server, database, akun: khusus admin lokal
    if (!isWebCashier) {
      if (!readOnlyByLicense && (can("view_database") || can("manage_database"))) {
        tabs.push({ key: "server", label: "Server Web", icon: "🌐", title: "Integrasi Server Web POS & API" });
        tabs.push({ key: "database", label: "Database", icon: "🗄", title: "Konfigurasi Database Server" });
      }
      if (!readOnlyByLicense && can("manage_accounts")) {
        tabs.push({ key: "accounts", label: "Akun", icon: "👤", title: "Manajemen Akun & Otoritas" });
      }
    }

    return tabs;
  }, [permissions, readOnlyByLicense, serverStoreInfo, authState.user]);

  const currentTabMeta = useMemo(() => {
    return availableTabs.find((item) => item.key === tab) || availableTabs[0] || { key: "order", label: "Order", icon: "🧾", title: "" };
  }, [availableTabs, tab]);

  useEffect(() => {
    if (availableTabs.length === 0) return;
    const isCurrentTabAllowed = availableTabs.some((item) => item.key === tab);
    if (!isCurrentTabAllowed) {
      setTab(availableTabs[0].key);
    }
  }, [availableTabs, tab]);

  const isOrderFocusTab = tab === "order" || tab === "orders";

  useEffect(() => {
    if (!isOrderFocusTab) {
      setShowOrderSidebar(false);
    }
  }, [isOrderFocusTab]);

  useEffect(() => {
    if (!isOrderFocusTab || !showOrderSidebar) return;

    function handlePointerDown(event) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest(".order-sidebar-toggle-btn")) return;
      if (sidebarRef.current?.contains(target)) return;
      setShowOrderSidebar(false);
    }

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [showOrderSidebar, isOrderFocusTab]);

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

  async function refreshLicenseState(forceRefresh = false) {
    try {
      const next = await window.posApi.getLicenseState({ forceRefresh });
      setLicenseState(next);
      if (next?.enteredCode) {
        setLicenseInput(next.enteredCode);
      }
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

  async function handleActivateLicense(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (!licenseInput.trim()) {
      setLicenseError("Kode lisensi wajib diisi.");
      return;
    }

    try {
      setLicenseLoading(true);
      setLicenseError("");
      const next = await window.posApi.activateLicense(licenseInput.trim());
      setLicenseState(next);
      if (next?.isWriteEnabled) {
        setAuthStatus("✓ Lisensi berhasil diaktifkan!");
        setShowLicenseScreen(false);
        setTimeout(() => setAuthStatus(""), 4000);
      } else {
        setLicenseError(next?.reason || "Kode lisensi tidak valid atau belum aktif.");
      }
    } catch (err) {
      setLicenseError(`Aktivasi lisensi gagal: ${err.message}`);
    } finally {
      setLicenseLoading(false);
    }
  }

  async function handleRefreshLicense() {
    try {
      setLicenseLoading(true);
      setLicenseError("");
      const next = await refreshLicenseState(true);
      if (next?.isWriteEnabled) {
        setAuthStatus("✓ Lisensi terverifikasi aktif.");
        setShowLicenseScreen(false);
        setTimeout(() => setAuthStatus(""), 3000);
      } else {
        setLicenseError(next?.reason || "Status lisensi telah diperbarui.");
      }
    } catch (err) {
      setLicenseError(`Refresh gagal: ${err.message}`);
    } finally {
      setLicenseLoading(false);
    }
  }

  useEffect(() => {
    async function init() {
      try {
        await refreshLicenseState();
        const state = await refreshAuthState();
        if (state.user) {
          await loadDataForPermissions(state.permissions || {});
          await refreshServerBootstrap();
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
    if (!authState.user) return;
    refreshServerBootstrap();

    const interval = setInterval(() => {
      refreshServerBootstrap();
    }, 25000);

    return () => clearInterval(interval);
  }, [authState.user]);

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
      await refreshServerBootstrap();
      setAuthStatus(result.message || "Akun awal berhasil dibuat.");
    } catch (err) {
      setAuthStatus(`Setup akun gagal: ${err.message}`);
    }
  }

  async function handleLogin(e) {
    e.preventDefault();
    setAuthStatus("");
    setAuthSubmitting(true);

    try {
      const result = await window.posApi.login(loginForm);
      setAuthState(result.state);
      setLoginForm({ username: "", password: "" });
      await loadDataForPermissions(result.state.permissions || {});
      await refreshServerBootstrap();
      setAuthStatus(result.message || "Login berhasil.");
      setTimeout(() => setAuthStatus(""), 3000);
    } catch (err) {
      setAuthStatus(`Login gagal: ${err.message}`);
    } finally {
      setAuthSubmitting(false);
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
          <p className="small-text">Sedang memeriksa status lisensi dan akun.</p>
        </section>
      </main>
    );
  }

  // Alur 1: Aktivasi Lisensi terlebih dahulu
  // Ditampilkan jika:
  // - User membuka secara manual (showLicenseScreen === true), ATAU
  // - Lisensi belum aktif DAN (sedang setup akun awal atau belum memilih bypass read-only)
  const isLicenseActive = licenseState?.isWriteEnabled === true;
  const needsLicenseActivation =
    showLicenseScreen ||
    (!isLicenseActive && (authState.needsSetup || !bypassLicenseReadOnly));

  if (needsLicenseActivation) {
    return (
      <main className="app-shell auth-shell">
        <section className="panel auth-panel" style={{ maxWidth: 520, width: "100%" }}>
          <div style={{ textAlign: "center", marginBottom: "18px" }}>
            <div style={{ fontSize: "2.5rem", marginBottom: "6px" }}>🔐</div>
            <h2 style={{ margin: "0 0 6px 0", fontSize: "1.4rem" }}>Aktivasi Lisensi Mudo POS</h2>
            <p className="small-text" style={{ margin: 0, color: "#64748b" }}>
              {authState.needsSetup
                ? "Silakan aktivasi lisensi terlebih dahulu sebelum melakukan setup akun awal."
                : "Masukkan kode lisensi resmi dari developer untuk mengaktifkan seluruh fitur POS."}
            </p>
          </div>

          <form className="license-activate-form" onSubmit={handleActivateLicense}>
            <div className="database-form-group">
              <label htmlFor="license-input" style={{ fontWeight: 600 }}>Kode Lisensi (LICENSE_CODE)</label>
              <input
                id="license-input"
                type="text"
                placeholder="Contoh: CLirU4Ur33RN"
                value={licenseInput}
                onChange={(e) => {
                  setLicenseInput(e.target.value.trim());
                  setLicenseError("");
                }}
                disabled={licenseLoading}
                style={{ letterSpacing: "1px", fontWeight: "bold", fontSize: "1.05rem" }}
              />
              <p className="small-text" style={{ marginTop: 4, color: "#64748b" }}>
                Masukkan kode lisensi resmi yang terdaftar untuk toko Anda.
              </p>
            </div>

            <div style={{ display: "flex", gap: "10px", marginTop: "14px" }}>
              <button
                type="submit"
                className="btn btn-save"
                disabled={licenseLoading || !licenseInput.trim()}
                style={{ flex: 2, marginTop: 0 }}
              >
                {licenseLoading ? "Memvalidasi Lisensi..." : "Aktivasi Lisensi Sekarang"}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleRefreshLicense}
                disabled={licenseLoading}
                style={{ flex: 1, marginTop: 0 }}
              >
                Refresh
              </button>
            </div>
          </form>

          {licenseError && (
            <div className="status" style={{ color: "#b42318", background: "#fef2f2", padding: "10px 12px", borderRadius: 8, marginTop: 14, border: "1px solid #fecaca" }}>
              ✗ {licenseError}
            </div>
          )}

          {authStatus && (
            <div className="status" style={{ color: "#166534", background: "#f0fdf4", padding: "10px 12px", borderRadius: 8, marginTop: 14, border: "1px solid #bbf7d0" }}>
              {authStatus}
            </div>
          )}

          <div style={{
            marginTop: "16px",
            padding: "12px",
            borderRadius: "8px",
            background: isLicenseActive ? "#f0fdf4" : "#f8fafc",
            border: `1px solid ${isLicenseActive ? "#bbf7d0" : "#e2e8f0"}`
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
              <span style={{ fontSize: "0.85rem", fontWeight: 600, color: "#475569" }}>Status Lisensi:</span>
              <span style={{
                padding: "2px 8px",
                borderRadius: "4px",
                fontSize: "0.78rem",
                fontWeight: 700,
                background: isLicenseActive ? "#22c55e" : "#ef4444",
                color: "#fff"
              }}>
                {isLicenseActive ? "AKTIF (Full Access)" : "TIDAK AKTIF"}
              </span>
            </div>
            <div style={{ fontSize: "0.83rem", color: "#334155" }}>
              <strong>Keterangan:</strong> {licenseState?.reason || "Kode lisensi belum diisi."}
            </div>
            {licenseState?.enteredCode && (
              <div style={{ fontSize: "0.8rem", color: "#64748b", marginTop: "2px" }}>
                Kode saat ini: <code>{licenseState.enteredCode}</code>
              </div>
            )}
          </div>

          <div style={{
            marginTop: "14px",
            padding: "10px 12px",
            borderRadius: "8px",
            background: "#f1f5f9",
            border: "1px solid #cbd5e1",
            fontSize: "0.82rem",
            color: "#475569"
          }}>
            <div style={{ fontWeight: 600, marginBottom: "4px" }}>Kontak Developer Resmi:</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "12px" }}>
              <span>📱 WA: <strong>{licenseState?.developerContact?.whatsapp || "+6283182647716"}</strong></span>
              <span>✉️ Email: <strong>{licenseState?.developerContact?.email || "rahmatnur844@gmail.com"}</strong></span>
            </div>
          </div>

          {!authState.needsSetup && (
            <div style={{ textAlign: "center", marginTop: "16px" }}>
              <button
                type="button"
                onClick={() => {
                  setBypassLicenseReadOnly(true);
                  setShowLicenseScreen(false);
                }}
                style={{
                  background: "none",
                  border: "none",
                  color: "#2563eb",
                  cursor: "pointer",
                  fontSize: "0.85rem",
                  textDecoration: "underline"
                }}
              >
                Lanjut ke Login (Mode Baca Saja / Read-Only) &rarr;
              </button>
            </div>
          )}

          {showLicenseScreen && (authState.user || !authState.needsSetup) && (
            <div style={{ textAlign: "center", marginTop: "12px" }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setShowLicenseScreen(false)}
                style={{ width: "100%", padding: "8px 14px", fontSize: "0.85rem" }}
              >
                Tutup &amp; Kembali
              </button>
            </div>
          )}
        </section>
      </main>
    );
  }

  // Alur 2: Setup Akun Awal (Hanya jika lisensi sudah aktif)
  if (authState.needsSetup) {
    return (
      <main className="app-shell auth-shell">
        <section className="panel auth-panel">
          <h2>Setup Akun Awal</h2>
          <p className="small-text">
            Lisensi telah aktif. Buat akun administrator awal untuk mengaktifkan login dan role akses.
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

          <div style={{ marginTop: "16px", textAlign: "center" }}>
            <button
              type="button"
              onClick={() => setShowLicenseScreen(true)}
              style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: "0.82rem" }}
            >
              🔐 Lisensi: <span style={{ color: "#16a34a", fontWeight: 600 }}>Aktif</span> • Ubah Lisensi
            </button>
          </div>
        </section>
      </main>
    );
  }

  // Alur 3: Login Akun
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
                ref={loginUsernameRef}
                id="login-username"
                type="text"
                name="username"
                autoFocus
                autoComplete="username"
                placeholder="Username akun Web POS / Lokal"
                value={loginForm.username || ""}
                onChange={(e) => setLoginForm((prev) => ({ ...prev, username: e.target.value }))}
                disabled={authSubmitting}
              />
            </div>

            <div className="database-form-group">
              <label htmlFor="login-password">Password</label>
              <input
                id="login-password"
                type="password"
                name="password"
                autoComplete="current-password"
                placeholder="Password akun"
                value={loginForm.password || ""}
                onChange={(e) => setLoginForm((prev) => ({ ...prev, password: e.target.value }))}
                disabled={authSubmitting}
              />
            </div>

            <button type="submit" className="btn btn-save" disabled={authSubmitting}>
              {authSubmitting ? "Memproses Login..." : "Login"}
            </button>
          </form>

          {authStatus && <div className="status">{authStatus}</div>}

          <div style={{ marginTop: "16px", textAlign: "center" }}>
            <button
              type="button"
              onClick={() => {
                setBypassLicenseReadOnly(false);
                setShowLicenseScreen(true);
              }}
              style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: "0.82rem" }}
            >
              🔐 Lisensi: {isLicenseActive ? (
                <span style={{ color: "#16a34a", fontWeight: 600 }}>Aktif</span>
              ) : (
                <span style={{ color: "#dc2626", fontWeight: 600 }}>Tidak Aktif (Read-Only)</span>
              )} • Kelola Lisensi
            </button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className={`app-shell app-dashboard ${isOrderFocusTab ? "order-focus-mode" : ""} ${isOrderFocusTab && showOrderSidebar ? "order-sidebar-open" : ""}`}>
      <aside ref={sidebarRef} className="sidebar panel">
        <div className="sidebar-brand">
          {serverStoreInfo?.store?.icon || serverStoreInfo?.store?.icon_toko ? (
            <img src={serverStoreInfo.store.icon || serverStoreInfo.store.icon_toko} alt="Icon Toko" className="sidebar-store-logo" />
          ) : serverStoreInfo?.store?.logo ? (
            <img src={serverStoreInfo.store.logo} alt="Logo" className="sidebar-store-logo" />
          ) : (
            <div className="sidebar-store-logo-placeholder">🏬</div>
          )}
          <div className="sidebar-brand-text">
            <h1>{serverStoreInfo?.store?.name || "Barangmudo POS"}</h1>
            <p className="small-text">{serverStoreInfo?.store?.branch_name ? `Cabang ${serverStoreInfo.store.branch_name}` : "Windows Cashier v2.1"}</p>
          </div>
        </div>

        <nav className="sidebar-nav">
          {availableTabs.map((item) => (
            <button
              key={item.key}
              className={`sidebar-tab ${tab === item.key ? "sidebar-tab-active" : ""}`}
              onClick={() => setTab(item.key)}
            >
              <span className="tab-icon">{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-user-wrap">
          <button
            className="sidebar-user-btn"
            type="button"
            onClick={() => setShowProfileMenu((value) => !value)}
            aria-haspopup="menu"
            aria-expanded={showProfileMenu}
          >
            <div className="sidebar-avatar">{(authState.user.displayName || authState.user.username || "U").charAt(0).toUpperCase()}</div>
            <div className="sidebar-user-info">
              <strong>{authState.user.displayName || authState.user.username}</strong>
              <p className="small-text">{authState.user.role}</p>
            </div>
            <span className="sidebar-user-caret">▾</span>
          </button>

          {showProfileMenu && (
            <div className="sidebar-user-menu panel">
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
      </aside>

      <section className="workspace-area">
        <header className="dashboard-topbar panel workspace-topbar">
          <div className="topbar-brand">
            {isOrderFocusTab && (
              <button
                className="top-icon-btn order-sidebar-toggle-btn"
                type="button"
                title={showOrderSidebar ? "Hide Navbar" : "Show Navbar"}
                aria-label={showOrderSidebar ? "Hide Navbar" : "Show Navbar"}
                onClick={() => setShowOrderSidebar((value) => !value)}
              >
                ☰
              </button>
            )}
            <div className="topbar-store-brand">
              {serverStoreInfo?.store?.icon || serverStoreInfo?.store?.icon_toko ? (
                <img src={serverStoreInfo.store.icon || serverStoreInfo.store.icon_toko} alt="Icon Toko" className="topbar-store-logo" />
              ) : serverStoreInfo?.store?.logo ? (
                <img src={serverStoreInfo.store.logo} alt="Logo" className="topbar-store-logo" />
              ) : null}
              <span className="topbar-store-name">
                {serverStoreInfo?.store?.name || "Barangmudo POS"}
              </span>
            </div>
            {!isOrderFocusTab && currentTabMeta?.title && <h2 className="topbar-page-heading">{currentTabMeta.title}</h2>}
            <div className={`connection-pill ${readOnlyByLicense ? "connection-pill-warning" : "connection-pill-ok"}`}>
              {readOnlyByLicense ? "Mode Read-Only" : "POS Desktop Siap"}
            </div>
          </div>

          <div className="topbar-actions">
            <div className="shift-label">Cabang: <strong>{serverStoreInfo?.store?.branch_name || authState.user?.branch?.name || "Cabang Utama"}</strong></div>
            <div className="shopify-label" style={{ background: "#0d9488", color: "#fff" }}>Web POS Live</div>
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

        <div className="workspace-body">
          {isOrderFocusTab && (
            <CustomOrder
              orders={orders}
              summary={orderSummary}
              onRefresh={loadOrders}
              canCreateOrder={can("create_order") && !readOnlyByLicense}
              canRetur={can("retur_order") && !readOnlyByLicense}
              compactMode={true}
              initialHistoryTab={tab === "orders" ? "today" : undefined}
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

          {tab === "products" && (can("view_product") || can("manage_product")) && (
            <ProductManagement />
          )}

          {tab === "printer" && (can("view_printer") || availableTabs.some((t) => t.key === "printer")) && (
            <PrinterSettings
              onApplied={(cfg) => setPrinter(cfg || null)}
              onStoreApplied={() => refreshServerBootstrap()}
            />
          )}

          {tab === "store" && can("manage_printer") && (
            <StoreSettings
              onApplied={() => {}}
              licenseState={licenseState}
              onLicenseStateChanged={setLicenseState}
              appReadOnly={readOnlyByLicense}
            />
          )}

          {tab === "server" && (
            <ServerSettings onApplied={() => {}} onLogout={handleLogout} />
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
        </div>
      </section>

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
