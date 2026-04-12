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

## Catatan Produksi

Project ini masih template pengembangan. Untuk produksi disarankan:

- Tambah logging error terstruktur
- Tambah backup data otomatis
- Tambah pengaturan printer dari UI (tanpa env manual)
