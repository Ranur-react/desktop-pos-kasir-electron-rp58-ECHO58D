# Panduan Setup Awal - Barangmudo POS

Setelah menginstall aplikasi, ikuti langkah-langkah di bawah untuk konfigurasi awal.

## Langkah 1: Jalankan Aplikasi

Buka aplikasi `Barangmudo POS` dari Start Menu atau ikon desktop.

## Langkah 2: Setup Printer (Tab "Printer")

1. Klik tab **"Printer"** di samping tab lainnya
2. Di bagian **"Default saat ini"** akan terlihat printer yang terdeteksi
3. **Pilih printer thermal Anda** dari dropdown list
   - Cari nama printer yang sesuai dengan printer fisik Anda (misal: "RP58 Printer" atau "USB Printer")
4. Klik **"Simpan Sebagai Default"**
5. Tunggu notifikasi **"Tersimpan"** muncul
6. Klik **"Refresh"** untuk verifikasi printer yang dipilih

> **Catatan:** Printer harus sudah terpasang dan aktif di Windows sebelum menjalankan aplikasi.

## Langkah 3: Setup Toko (File `.env`)

Aplikasi membaca konfigurasi toko dari file `.env`. File ini otomatis dibuat saat pertama kali Anda simpan printer, tetapi Anda bisa mengeditnya secara manual.

### Lokasi File `.env`

- Tekan **`Win + R`**
- Ketik: `%appdata%`
- Buka folder: **`Barangmudo POS`**
- Edit file: **`.env`** dengan Notepad atau text editor

### Konfigurasi `.env` (Template)

```env
# Nama dan identitas toko (untuk struk)
STORE_TITLE=Berkah Sayur
STORE_SUBTITLE=By Barang Mudo
STORE_ADDRESS=Jl. Raya Sungai Lareh, Lubuk Mintrun
STORE_WA=0852-7803-5943

# Printer thermal (otomatis tersimpan saat Anda klik "Simpan Sebagai Default")
PRINTER_INTERFACE=printer:\\SERVER\RP58 Printer - USB

# Logo toko untuk struk (opsional)
# Path boleh absolut atau relatif dari folder aplikasi
STORE_LOGO_PATH=./assets/logo-toko.png

# Lebar karakter printer 58mm
PRINTER_CHAR_WIDTH=32

# QRIS statis untuk pembayaran (opsional - tanyakan ke bank Anda)
QRIS_STATIC_CONTENT=00020101021126540012COM.DOKU.WWW...

# Folder penyimpanan data transaksi (opsional)
# Default: AppData\Roaming\Barangmudo POS\pos-data\
# Untuk backup ke OneDrive:
DATA_PATH=C:\Users\[NamaUser]\OneDrive\Pos Data\pos-data
```

Setelah edit, **simpan file** dan tutup aplikasi.

## Langkah 4: Persiapan Katalog Produk (Opsional)

Jika ingin menggunakan fitur **Order Katalog** (search produk berdasarkan file CSV):

1. Siapkan file CSV produk dari Shopify atau buat sendiri
2. Letakkan di folder: **`C:\Users\[NamaUser]\AppData\Roaming\Barangmudo POS\assets\`** (buat jika belum ada)
3. Restart aplikasi
4. Buka tab **"Order Katalog"** untuk test

> **Format CSV:** Harus memiliki kolom: Handle, Title, Variant SKU, Variant Price, Option1 Value, dll (standard Shopify export)

## Langkah 5: Test Cetak Struk

1. Pastikan printer thermal sudah on dan siap cetak
2. Buka tab **"Transaksi"** atau **"Order"**
3. Tambah item & lakukan pembayaran
4. Klik **"Cetak Struk"**
5. Struk harus keluar dari printer

Jika tidak berhasil:
- Cek apakah printer adalah default di tab **"Printer"**
- Cek koneksi printer (USB atau network)
- Buka aplikasi **ulang** jika printer baru ditegur/ganti

## Folder Penting Untuk Backup

**Data transaksi disimpan di:**
```
C:\Users\[NamaUser]\AppData\Roaming\Barangmudo POS\pos-data\
```

Folder ini boleh di-backup ke OneDrive atau external drive. Edit `DATA_PATH` di `.env` jika ingin ubah lokasi.

## Troubleshooting

### Printer tidak terdeteksi di tab "Printer"

**Solusi:**
1. Pastikan printer sudah on dan terhubung ke komputer
2. Cek di **Settings → Devices → Printers & scanners** bahwa printer sudah ada
3. Jalankan printer test page dari Windows untuk verifikasi
4. Restart aplikasi

### Tab "Printer" blank atau error "Gagal memuat printer"

**Solusi:**
- Jalankan aplikasi sebagai **Administrator**
- Jika masih error, update driver printer dari vendor

### File `.env` tidak terbaca setelah saya edit

**Solusi:**
1. Tutup aplikasi sepenuhnya
2. Edit file `.env` di folder `AppData\Roaming\Barangmudo POS\`
3. **Jangan** gunakan file `.env` di folder instalasi (`Program Files`)
4. Jalankan ulang aplikasi

### "Cannot save transaction" atau error permission denied

**Penyebab:** Folder `pos-data` tidak bisa diakses oleh aplikasi.

**Solusi:**
1. Pastikan folder `pos-data` ada di: `AppData\Roaming\Barangmudo POS\pos-data\`
2. Jika pakai path custom di `DATA_PATH=...`, pastikan path tersebut ada dan user punya write permission
3. Restart aplikasi

### Cetak struk gagal ("Printer tidak terdeteksi")

**Solusi:**
1. Buka tab **"Printer"**
2. Verify printer default sudah tepat
3. Klik **"Refresh"** untuk reload printer list
4. Jika masih gagal, jalankan aplikasi sebagai **Administrator**

## Support

Jika ada pertanyaan atau masalah:
- Cek dokumentasi di README.md
- Capture screenshot error message
- Tanya ke developer dengan include detail OS dan printer model
