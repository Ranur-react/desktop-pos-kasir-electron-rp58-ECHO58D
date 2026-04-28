import { useEffect, useState } from "react";

function formatDate(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

export default function AccountSettings({ currentUser, onAuthStateChanged }) {
  const [accounts, setAccounts] = useState([]);
  const [roles, setRoles] = useState([]);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  const [newAccount, setNewAccount] = useState({
    username: "",
    displayName: "",
    password: "",
    role: "cashier"
  });

  const [passwordDraft, setPasswordDraft] = useState({});

  async function loadAccounts() {
    setLoading(true);
    try {
      const data = await window.posApi.listAccounts();
      setAccounts(data.accounts || []);
      setRoles(data.roles || []);
      setStatus("");
    } catch (error) {
      setStatus(`Gagal memuat akun: ${error.message}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAccounts().catch(() => {});
  }, []);

  async function handleCreateAccount(e) {
    e.preventDefault();

    if (!newAccount.username.trim() || !newAccount.password.trim()) {
      setStatus("Username dan password wajib diisi.");
      return;
    }

    setLoading(true);
    try {
      const result = await window.posApi.createAccount(newAccount);
      setAccounts(result.accounts || []);
      setStatus(result.message || "Akun berhasil ditambahkan.");
      setNewAccount({
        username: "",
        displayName: "",
        password: "",
        role: newAccount.role || "cashier"
      });
    } catch (error) {
      setStatus(`Tambah akun gagal: ${error.message}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleRoleChange(accountId, role) {
    setLoading(true);
    try {
      const result = await window.posApi.changeAccountRole({ accountId, role });
      setAccounts(result.accounts || []);
      setStatus(result.message || "Role akun diperbarui.");
      if (result.state && typeof onAuthStateChanged === "function") {
        onAuthStateChanged(result.state);
      }
    } catch (error) {
      setStatus(`Ubah role gagal: ${error.message}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleResetPassword(accountId) {
    const newPassword = (passwordDraft[accountId] || "").trim();
    if (!newPassword) {
      setStatus("Password baru wajib diisi.");
      return;
    }

    setLoading(true);
    try {
      const result = await window.posApi.changeAccountPassword({ accountId, newPassword });
      setStatus(result.message || "Password berhasil diubah.");
      setPasswordDraft((prev) => ({ ...prev, [accountId]: "" }));
    } catch (error) {
      setStatus(`Ganti password gagal: ${error.message}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="panel account-panel">
      <h2>Manajemen Akun</h2>
      <p className="small-text">Tambah akun, ubah role akses, dan reset password akun pengguna.</p>

      <form className="account-create-form" onSubmit={handleCreateAccount}>
        <div className="form-row">
          <div className="database-form-group">
            <label htmlFor="new-username">Username</label>
            <input
              id="new-username"
              value={newAccount.username}
              onChange={(e) => setNewAccount((prev) => ({ ...prev, username: e.target.value }))}
              placeholder="contoh: kasir1"
              disabled={loading}
            />
          </div>
          <div className="database-form-group">
            <label htmlFor="new-displayname">Nama Tampilan</label>
            <input
              id="new-displayname"
              value={newAccount.displayName}
              onChange={(e) => setNewAccount((prev) => ({ ...prev, displayName: e.target.value }))}
              placeholder="contoh: Kasir Shift Pagi"
              disabled={loading}
            />
          </div>
        </div>

        <div className="form-row">
          <div className="database-form-group">
            <label htmlFor="new-password">Password</label>
            <input
              id="new-password"
              type="password"
              value={newAccount.password}
              onChange={(e) => setNewAccount((prev) => ({ ...prev, password: e.target.value }))}
              placeholder="minimal 6 karakter"
              disabled={loading}
            />
          </div>
          <div className="database-form-group">
            <label htmlFor="new-role">Role</label>
            <select
              id="new-role"
              className="printer-select"
              value={newAccount.role}
              onChange={(e) => setNewAccount((prev) => ({ ...prev, role: e.target.value }))}
              disabled={loading}
            >
              {roles.map((role) => (
                <option key={role.key} value={role.key}>{role.label}</option>
              ))}
            </select>
          </div>
        </div>

        <button type="submit" className="btn btn-save" disabled={loading}>Tambah Akun</button>
      </form>

      {status && <div className="status">{status}</div>}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Username</th>
              <th>Nama</th>
              <th>Role</th>
              <th>Login Terakhir</th>
              <th>Password Baru</th>
              <th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {accounts.length === 0 && (
              <tr>
                <td colSpan="6" className="empty-cell">Belum ada akun.</td>
              </tr>
            )}
            {accounts.map((account) => (
              <tr key={account.id}>
                <td className="mono">{account.username}</td>
                <td>{account.displayName || "-"}</td>
                <td>
                  <select
                    className="printer-select account-role-select"
                    value={account.role}
                    onChange={(e) => handleRoleChange(account.id, e.target.value)}
                    disabled={loading || currentUser?.id === account.id}
                    title={currentUser?.id === account.id ? "Role akun login aktif tidak bisa diubah dari sini." : ""}
                  >
                    {roles.map((role) => (
                      <option key={role.key} value={role.key}>{role.label}</option>
                    ))}
                  </select>
                </td>
                <td>{formatDate(account.lastLoginAt)}</td>
                <td>
                  <input
                    type="password"
                    value={passwordDraft[account.id] || ""}
                    onChange={(e) => setPasswordDraft((prev) => ({ ...prev, [account.id]: e.target.value }))}
                    placeholder="password baru"
                    disabled={loading}
                  />
                </td>
                <td>
                  <button
                    className="btn btn-secondary"
                    onClick={() => handleResetPassword(account.id)}
                    disabled={loading}
                  >
                    Reset Password
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
