# POS Kasir Desktop (Electron + React + ESC/POS)

Aplikasi kasir desktop sederhana untuk transaksi cash harian dengan dukungan printer thermal dan cash drawer.

## Tujuan Source Code

Source code ini dibuat untuk kebutuhan **development** dan **pengujian** alur POS desktop, khususnya:

- Pengujian cetak struk thermal ESC/POS menggunakan printer **Blue Print ECHO58D**
- Pengujian perintah **buka cash drawer otomatis** setelah proses cetak/transaksi

Fokus utama project ini adalah template teknis yang mudah dikembangkan lebih lanjut sebelum dipakai penuh di lingkungan produksi.

## Fitur Utama

- Input `Nominal` (rupiah) dan `Deskripsi transaksi`
- Tombol transaksi `Uang Masuk` dan `Uang Keluar`
- Tombol `Cetak Struk & Buka Laci`
- Riwayat transaksi harian
- Summary harian: total masuk, total keluar, saldo
- Simpan data lokal per hari (`JSON`)
- Cetak struk ESC/POS + kick cash drawer

## Stack

- Electron (desktop app)
- React + Vite (UI)
- node-thermal-printer (buffer ESC/POS)
- Windows RAW spool fallback driver (internal project)

## Struktur Folder

```text
electron/
  main.js
  preload.js
  services/
    printer.js
    storage.js
    windows-printer-driver.js
src/
  App.jsx
  App.css
  main.jsx
```

## Prasyarat di Laptop Lain

- OS: Windows 10/11
- Node.js LTS 18 atau 20
- NPM (ikut dari Node.js)
- Printer thermal sudah terpasang di `Devices and Printers`
- Nama printer sesuai default project: `RP58 Printer` (atau ubah lewat env)

## Cara Menjalankan di Laptop Baru

### 1) Clone repository

```powershell
git clone <URL_REPO_ANDA>
cd <NAMA_FOLDER_REPO>
```

### 2) Install dependency

```powershell
npm.cmd install
```

Catatan: gunakan `npm.cmd` di PowerShell jika muncul error execution policy untuk `npm.ps1`.

### 3) Jalankan mode development

```powershell
npm.cmd run dev
```

Akan menjalankan:

- Vite dev server di `http://localhost:5173`
- Electron app (window POS)

### 4) Build frontend (opsional)

```powershell
npm.cmd run build
```

## Konfigurasi Printer

Default printer interface saat ini:

- `printer:RP58 Printer`

Jika nama printer di laptop lain berbeda:

```powershell
$env:PRINTER_INTERFACE="printer:NAMA_PRINTER_ANDA"
npm.cmd run dev
```

Opsional nama toko di struk:

```powershell
$env:STORE_NAME="TOKO SAYA"
npm.cmd run dev
```

## Lokasi Data Transaksi

Data transaksi disimpan di folder `userData` Electron dengan format per hari:

- `transactions-YYYY-MM-DD.json`

Contoh lokasi umum di Windows:

- `%APPDATA%\pos-electron-echo58d\data\transactions-2026-04-12.json`

## Alur Penggunaan

1. Isi `Nominal` dan `Deskripsi transaksi`.
2. Klik `Uang Masuk` atau `Uang Keluar`.
3. Data transaksi tersimpan lokal.
4. Aplikasi otomatis cetak struk + kirim perintah buka laci.
5. Tombol `Cetak Struk & Buka Laci` bisa dipakai untuk cetak ulang transaksi terakhir.

## Troubleshooting

### Printer test page berhasil tapi app gagal print

- Pastikan nama printer di app sama persis dengan nama di `Devices and Printers`.
- Coba jalankan dengan env manual:

```powershell
$env:PRINTER_INTERFACE="printer:RP58 Printer"
npm.cmd run dev
```

### Error `npm.ps1 cannot be loaded`

- Gunakan `npm.cmd` (bukan `npm`) di PowerShell.

### Cash drawer tidak terbuka

- Perintah drawer saat ini: `ESC p 0 25 250`
- Ubah pulsa di `electron/services/printer.js` jika tipe drawer butuh timing lain.

## Fitur Baru (Catalog + Printer Settings)

- Order dari katalog produk CSV Shopify (`assets/*.csv`)
- Search produk + SKU + kategori
- Auto-select hasil search paling relevan (tanpa klik manual)
- Fallback custom order: jika produk tidak ditemukan, operator tetap bisa tambah item manual dari kolom search
- Tab `Printer` untuk:
  - melihat daftar printer Windows
  - memilih default thermal printer
  - simpan ke `.env` (`PRINTER_INTERFACE`)

## Tutorial Release App Untuk User Umum (.exe / .msi)

### 1) Siapkan dependency packaging

```powershell
npm.cmd install
```

### 2) Build installer Windows (.exe + portable)

```powershell
npm.cmd run pack:win
```

Output ada di folder `release/`:

- `Barangmudo POS Setup x.y.z.exe` (installer)
- `Barangmudo POS x.y.z.exe` (portable)

### 3) Build installer MSI

```powershell
npm.cmd run pack:msi
```

Output di folder `release/`:

- `Barangmudo POS Setup x.y.z.msi`

### Jika build MSI gagal karena `Cannot create symbolic link`

Penyebab:

- `electron-builder` mengekstrak helper binary `winCodeSign`
- archive tersebut berisi symbolic link
- Windows memblokir pembuatan symlink untuk user biasa jika **Developer Mode** belum aktif atau terminal tidak dijalankan sebagai Administrator

Solusi yang disarankan:

1. Aktifkan **Developer Mode** di Windows:
   - `Settings` → `Privacy & security` → `For developers` → aktifkan `Developer Mode`
1. Hapus cache lama:

```powershell
Remove-Item "$env:LOCALAPPDATA\electron-builder\Cache\winCodeSign" -Recurse -Force -ErrorAction SilentlyContinue
```

1. Buka ulang terminal, lalu jalankan lagi:

```powershell
npm.cmd run pack:msi
```

Alternatif cepat:

- Jalankan PowerShell sebagai **Administrator** lalu ulangi build
- Jika user tidak butuh MSI, gunakan installer `.exe`:

```powershell
npm.cmd run pack:win
```

### 4) File yang dibagikan ke user

Pilih salah satu:

- Installer `.exe` (paling umum)
- Installer `.msi` (untuk kebutuhan enterprise/IT policy)
- Portable `.exe` (tanpa instalasi)

### 5) Checklist sebelum dibagikan

- Printer thermal sudah terpasang di Windows user
- Tab `Printer` di app sudah dipakai untuk memilih default printer
- Folder `assets` berisi CSV produk terbaru
- File `.env` sudah berisi identitas toko (STORE_TITLE, STORE_ADDRESS, dll)

## Catatan Produksi

Untuk produksi disarankan:

- Tambah code signing certificate agar installer tidak dianggap unknown publisher
- Tambah backup otomatis untuk folder `pos-data`
- Tambah auto-update mechanism (mis. GitHub Releases / private update server)
