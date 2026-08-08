import { useEffect, useMemo, useState } from "react";

function formatRupiah(value) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0
  }).format(Number(value || 0));
}

function makeEmptyForm() {
  return {
    id: "",
    name: "",
    description: "",
    category: "",
    sku: "",
    unit: "Pcs",
    sellPrice: "",
    costPrice: "",
    stockQty: "",
    variants: [{ id: "", name: "Default", price: "" }]
  };
}

export default function ProductManagement() {
  const [catalog, setCatalog] = useState({ productsRaw: [], categories: [] });
  const [csvCatalog, setCsvCatalog] = useState({ products: [], sourceFilesCount: 0 });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState("manual");
  const [selectedIds, setSelectedIds] = useState([]);
  const [editingId, setEditingId] = useState("");
  const [form, setForm] = useState(makeEmptyForm());

  async function loadManualProducts() {
    try {
      setLoading(true);
      const data = await window.posApi.listManualProducts();
      setCatalog(data || { productsRaw: [], categories: [] });
    } catch (err) {
      setStatus(`Gagal memuat produk manual: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadManualProducts().catch(() => {});
  }, []);

  useEffect(() => {
    if (activeTab !== "csv") return;
    (async () => {
      try {
        const data = await window.posApi.getCatalog();
        setCsvCatalog(data || { products: [], sourceFilesCount: 0 });
      } catch (err) {
        setStatus(`Gagal memuat katalog CSV: ${err.message}`);
      }
    })();
  }, [activeTab]);

  const products = catalog.productsRaw || [];

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) => {
      return (
        String(p.name || "").toLowerCase().includes(q) ||
        String(p.sku || "").toLowerCase().includes(q) ||
        String(p.category || "").toLowerCase().includes(q)
      );
    });
  }, [products, search]);

  const categorySummary = useMemo(() => {
    const bucket = new Map();
    for (const p of products) {
      const key = p.category || "Lainnya";
      bucket.set(key, (bucket.get(key) || 0) + 1);
    }
    return Array.from(bucket.entries())
      .map(([name, total]) => ({ name, total }))
      .sort((a, b) => a.name.localeCompare(b.name, "id"));
  }, [products]);

  function resetForm() {
    setEditingId("");
    setForm(makeEmptyForm());
  }

  function fillFormFromProduct(product) {
    const variants = Array.isArray(product.variants) && product.variants.length > 0
      ? product.variants.map((v) => ({
          id: v.id || "",
          name: v.name || "Default",
          price: String(v.price ?? "")
        }))
      : [{ id: "", name: "Default", price: String(product.sellPrice || "") }];

    setEditingId(product.id);
    setForm({
      id: product.id,
      name: product.name || "",
      description: product.description || "",
      category: product.category || "",
      sku: product.sku || "",
      unit: product.unit || "Pcs",
      sellPrice: String(product.sellPrice || ""),
      costPrice: String(product.costPrice || ""),
      stockQty: String(product.stockQty || ""),
      variants
    });
  }

  function makeVariantRow() {
    return {
      id: `tmp-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      name: "",
      price: ""
    };
  }

  function addVariantRow() {
    setForm((prev) => ({
      ...prev,
      variants: [...(prev.variants || []), makeVariantRow()]
    }));
  }

  function removeVariantRow(targetId) {
    setForm((prev) => {
      const next = (prev.variants || []).filter((v) => String(v.id) !== String(targetId));
      return {
        ...prev,
        variants: next.length > 0 ? next : [{ id: "", name: "Default", price: prev.sellPrice || "" }]
      };
    });
  }

  function updateVariantRow(targetId, field, value) {
    setForm((prev) => ({
      ...prev,
      variants: (prev.variants || []).map((v) =>
        String(v.id) === String(targetId) ? { ...v, [field]: value } : v
      )
    }));
  }

  async function handleSaveProduct(e) {
    e.preventDefault();

    if (!form.name.trim()) {
      setStatus("Nama produk wajib diisi.");
      return;
    }

    const cleanedVariants = (form.variants || [])
      .map((v, idx) => ({
        id: v.id || undefined,
        name: String(v.name || "").trim() || `Varian ${idx + 1}`,
        price: Number(v.price || form.sellPrice || 0)
      }))
      .filter((v) => Number.isFinite(v.price) && v.price >= 0);

    if (cleanedVariants.length === 0) {
      setStatus("Minimal 1 varian dengan harga valid wajib diisi.");
      return;
    }

    const payload = {
      id: editingId || undefined,
      name: form.name,
      description: form.description,
      category: form.category,
      sku: form.sku,
      unit: form.unit,
      sellPrice: Number(form.sellPrice || 0),
      costPrice: Number(form.costPrice || 0),
      stockQty: Number(form.stockQty || 0),
      variants: cleanedVariants
    };

    try {
      setSaving(true);
      const result = editingId
        ? await window.posApi.updateManualProduct(payload)
        : await window.posApi.createManualProduct(payload);

      setCatalog(result.catalog || { productsRaw: [], categories: [] });
      setStatus(result.message || "Produk tersimpan.");
      resetForm();
    } catch (err) {
      setStatus(`Gagal simpan produk: ${err.message}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteOne(id) {
    try {
      setSaving(true);
      const result = await window.posApi.deleteManualProduct(id);
      setCatalog(result.catalog || { productsRaw: [], categories: [] });
      setStatus(result.message || "Produk dihapus.");
      setSelectedIds((prev) => prev.filter((x) => x !== id));
      if (editingId === id) resetForm();
    } catch (err) {
      setStatus(`Gagal hapus produk: ${err.message}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteSelected() {
    if (selectedIds.length === 0) {
      setStatus("Pilih produk terlebih dahulu.");
      return;
    }

    try {
      setSaving(true);
      const result = await window.posApi.deleteManyManualProducts(selectedIds);
      setCatalog(result.catalog || { productsRaw: [], categories: [] });
      setStatus(result.message || "Produk terpilih dihapus.");
      setSelectedIds([]);
      if (selectedIds.includes(editingId)) resetForm();
    } catch (err) {
      setStatus(`Gagal hapus terpilih: ${err.message}`);
    } finally {
      setSaving(false);
    }
  }

  function toggleSelected(id, checked) {
    setSelectedIds((prev) => {
      if (checked) return [...new Set([...prev, id])];
      return prev.filter((x) => x !== id);
    });
  }

  function isSelected(id) {
    return selectedIds.includes(id);
  }

  return (
    <section className="panel product-mgmt-panel">
      <div className="catalog-header-row">
        <div>
          <h2>Manajemen Produk & Inventori</h2>
          <p className="small-text catalog-meta-text">
            Kelola produk manual untuk toko tanpa Shopify, tetap bisa dipakai bersamaan dengan katalog CSV.
          </p>
        </div>
      </div>

      <div className="oh-tabs" style={{ marginBottom: "8px", width: "fit-content" }}>
        <button
          className={`oh-tab-btn${activeTab === "manual" ? " oh-tab-active" : ""}`}
          onClick={() => setActiveTab("manual")}
        >
          Produk Manual (Standalone Store)
        </button>
        <button
          className={`oh-tab-btn${activeTab === "category" ? " oh-tab-active" : ""}`}
          onClick={() => setActiveTab("category")}
        >
          Kategori Produk (Standalone)
        </button>
        <button
          className={`oh-tab-btn${activeTab === "csv" ? " oh-tab-active" : ""}`}
          onClick={() => setActiveTab("csv")}
        >
          Katalog Shopify (Koneksi CSV)
        </button>
      </div>

      {activeTab === "manual" && (
        <>
          <div className="catalog-toolbar" style={{ marginBottom: "12px" }}>
            <div className="form-inline-row">
              <input
                className="search-input catalog-search"
                placeholder="Cari Nama Produk / SKU..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                disabled={loading || saving}
              />
              <button className="btn btn-danger" onClick={handleDeleteSelected} disabled={saving || selectedIds.length === 0}>
                Hapus Terpilih
              </button>
            </div>
          </div>

          <div className="product-mgmt-grid">
            <section className="panel product-form-panel">
              <h3>{editingId ? "Ubah Produk Manual" : "Tambah Produk Standalone Baru"}</h3>
              <form className="custom-order-form" onSubmit={handleSaveProduct}>
                <label>Nama Produk</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="Masukkan nama produk"
                  disabled={saving}
                />

                <label>Deskripsi Produk</label>
                <input
                  value={form.description}
                  onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                  placeholder="Tambahkan deskripsi singkat"
                  disabled={saving}
                />

                <div className="form-row">
                  <div className="database-form-group">
                    <label>Kategori</label>
                    <input
                      value={form.category}
                      onChange={(e) => setForm((prev) => ({ ...prev, category: e.target.value }))}
                      placeholder="Contoh: Sayur"
                      disabled={saving}
                    />
                  </div>
                  <div className="database-form-group">
                    <label>SKU Produk</label>
                    <input
                      value={form.sku}
                      onChange={(e) => setForm((prev) => ({ ...prev, sku: e.target.value }))}
                      placeholder="Contoh: AYM-KMP-02"
                      disabled={saving}
                    />
                  </div>
                </div>

                <div className="form-row">
                  <div className="database-form-group">
                    <label>Harga Jual</label>
                    <input
                      type="number"
                      min="0"
                      value={form.sellPrice}
                      onChange={(e) => setForm((prev) => ({ ...prev, sellPrice: e.target.value }))}
                      disabled={saving}
                    />
                  </div>
                  <div className="database-form-group">
                    <label>Harga Modal</label>
                    <input
                      type="number"
                      min="0"
                      value={form.costPrice}
                      onChange={(e) => setForm((prev) => ({ ...prev, costPrice: e.target.value }))}
                      disabled={saving}
                    />
                  </div>
                </div>

                <div className="form-row">
                  <div className="database-form-group">
                    <label>Stok</label>
                    <input
                      type="number"
                      min="0"
                      value={form.stockQty}
                      onChange={(e) => setForm((prev) => ({ ...prev, stockQty: e.target.value }))}
                      disabled={saving}
                    />
                  </div>
                  <div className="database-form-group">
                    <label>Satuan</label>
                    <input
                      value={form.unit}
                      onChange={(e) => setForm((prev) => ({ ...prev, unit: e.target.value }))}
                      placeholder="Pcs"
                      disabled={saving}
                    />
                  </div>
                </div>

                <div className="database-form-group">
                  <label>Daftar Varian Produk</label>
                  <div className="variant-list">
                    {(form.variants || []).map((variant, idx) => (
                      <div key={variant.id || `var-${idx}`} className="variant-row">
                        <div className="database-form-group" style={{ flex: 1 }}>
                          <label>Nama Varian</label>
                          <input
                            value={variant.name}
                            onChange={(e) => updateVariantRow(variant.id, "name", e.target.value)}
                            placeholder={`Contoh: 250 gr, Paket ${idx + 1}`}
                            disabled={saving}
                          />
                        </div>
                        <div className="database-form-group" style={{ width: "170px" }}>
                          <label>Harga</label>
                          <input
                            type="number"
                            min="0"
                            value={variant.price}
                            onChange={(e) => updateVariantRow(variant.id, "price", e.target.value)}
                            disabled={saving}
                          />
                        </div>
                        <button
                          type="button"
                          className="btn btn-out"
                          onClick={() => removeVariantRow(variant.id)}
                          disabled={saving || (form.variants || []).length <= 1}
                        >
                          Hapus
                        </button>
                      </div>
                    ))}
                  </div>
                  <button type="button" className="btn btn-secondary" onClick={addVariantRow} disabled={saving}>
                    + Tambah Varian
                  </button>
                </div>

                <div className="store-actions-row">
                  {editingId && (
                    <button type="button" className="btn btn-secondary" onClick={resetForm} disabled={saving}>
                      Batal & Kembali
                    </button>
                  )}
                  <button type="submit" className="btn btn-save" disabled={saving}>
                    {editingId ? "Simpan Perubahan" : "Simpan Produk"}
                  </button>
                </div>
              </form>
            </section>

            <section className="panel">
              <h3>Daftar Produk Manual Aktif</h3>
              <div className="table-wrap" style={{ marginTop: "12px" }}>
                <table>
                  <thead>
                    <tr>
                      <th></th>
                      <th>Nama Produk</th>
                      <th>SKU</th>
                      <th>Kategori</th>
                      <th>Harga</th>
                      <th>Stok</th>
                      <th>Aksi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredProducts.length === 0 && (
                      <tr>
                        <td colSpan="7" className="empty-cell">{loading ? "Memuat..." : "Belum ada produk manual."}</td>
                      </tr>
                    )}
                    {filteredProducts.map((item) => (
                      <tr key={item.id}>
                        <td>
                          <input
                            type="checkbox"
                            checked={isSelected(item.id)}
                            onChange={(e) => toggleSelected(item.id, e.target.checked)}
                          />
                        </td>
                        <td>{item.name}</td>
                        <td className="mono">{item.sku || "-"}</td>
                        <td>{item.category || "Lainnya"}</td>
                        <td className="txt-in">{formatRupiah(item.sellPrice)}</td>
                        <td>{item.stockQty} {item.unit || "Pcs"}</td>
                        <td>
                          <div className="variant-actions">
                            <button className="btn btn-secondary" onClick={() => fillFormFromProduct(item)} disabled={saving}>
                              Edit
                            </button>
                            <button className="btn btn-out" onClick={() => handleDeleteOne(item.id)} disabled={saving}>
                              Hapus
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        </>
      )}

      {activeTab === "category" && (
        <section className="product-mgmt-grid product-mgmt-grid-single">
          <section className="panel">
            <h3>Daftar Kategori Produk Aktif</h3>
            <div className="table-wrap" style={{ marginTop: "12px" }}>
              <table>
                <thead>
                  <tr>
                    <th>Nama Kategori Produk</th>
                    <th>Jumlah Produk Terkait</th>
                  </tr>
                </thead>
                <tbody>
                  {categorySummary.length === 0 && (
                    <tr>
                      <td colSpan="2" className="empty-cell">Belum ada kategori.</td>
                    </tr>
                  )}
                  {categorySummary.map((c) => (
                    <tr key={c.name}>
                      <td>{c.name}</td>
                      <td className="txt-in">{c.total} Produk</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </section>
      )}

      {activeTab === "csv" && (
        <section className="panel product-mgmt-grid product-mgmt-grid-single">
          <div className="catalog-header-row">
            <div>
              <h3>Katalog Shopify (Koneksi CSV)</h3>
              <p className="small-text">Sumber data dari file CSV Shopify: {csvCatalog.sourceFilesCount || 0} file.</p>
            </div>
            <button
              className="btn btn-secondary"
              onClick={async () => {
                try {
                  const data = await window.posApi.reloadCatalog();
                  setCsvCatalog(data || { products: [], sourceFilesCount: 0 });
                  setStatus("Katalog CSV berhasil di-refresh.");
                } catch (err) {
                  setStatus(`Gagal reload CSV: ${err.message}`);
                }
              }}
            >
              Reload CSV
            </button>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Nama Produk</th>
                  <th>Kategori</th>
                  <th>Varian</th>
                  <th>Harga Awal</th>
                </tr>
              </thead>
              <tbody>
                {(csvCatalog.products || []).length === 0 && (
                  <tr>
                    <td colSpan="4" className="empty-cell">Belum ada produk CSV.</td>
                  </tr>
                )}
                {(csvCatalog.products || []).map((p) => (
                  <tr key={p.id}>
                    <td>{p.title}</td>
                    <td>{p.category || "Lainnya"}</td>
                    <td>{(p.variants || []).length}</td>
                    <td className="txt-in">
                      {formatRupiah(Math.min(...(p.variants || [{ price: 0 }]).map((v) => Number(v.price || 0))))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {status && <div className="status">{status}</div>}
    </section>
  );
}
