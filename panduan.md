
# Panduan Lengkap Deployment Video Collect Dataset (Web & Server)

Panduan ini berisi langkah-langkah dari awal mengatur server (Node.js & PM2), melakukan clone repositori, menginstal dependensi, hingga mem-build dan menjalankan aplikasi secara production.

## Informasi Server
* **IP Server:** 10.44.0.203
* **Username:** alim
* **Password:** changeme

---

## 1. Persiapan Server (Install Node.js & PM2)
Masuk ke server via SSH, lalu jalankan perintah berikut secara berurutan untuk menginstal Node.js versi 20 (LTS) dan PM2:

```bash
# Update repository linux dan install curl
sudo apt update
sudo apt install -y curl

# Ambil script setup Node.js versi 20
curl -fsSL [https://deb.nodesource.com/setup_20.x](https://deb.nodesource.com/setup_20.x) | sudo -E bash -

# Install Node.js (ini otomatis menginstal npm juga)
sudo apt install nodejs -y

# Cek apakah instalasi berhasil (harus keluar angka v20.x.x)
node -v

# Install PM2 secara global untuk manajemen server
sudo npm install -g pm2

```

## 2. Clone Repositori

Unduh kode dari GitHub ke dalam server:

```bash
cd ~
git clone [https://github.com/khairililmi2468gmailcom/video-collect-dataset.git](https://github.com/khairililmi2468gmailcom/video-collect-dataset.git)
cd video-collect-dataset

```

## 3. Instalasi Dependensi

Install paket NPM yang dibutuhkan untuk sisi Server maupun Web (Mobile App).

```bash
# Install untuk server API
cd server
npm install

# Install untuk frontend (Expo Web)
cd ../mobile-app
npm install

```

## 4. Jalankan Backend Server dengan PM2

Pastikan Anda berada di folder `server`, lalu jalankan aplikasi backend di latar belakang.

```bash
cd ~/video-collect-dataset/server

# Jalankan server dan beri nama "video-api"
pm2 start index.js --name "video-api"

# Buat server otomatis menyala jika VM/Server restart
pm2 startup

# Simpan konfigurasi PM2
pm2 save

```

## 5. Seed Data JSON ke Database

Masukkan 50 kalimat awal ke dalam database. Pastikan server API sudah menyala (Langkah 4) sebelum menjalankan perintah ini.

```bash
cd ~/video-collect-dataset/server
curl -X POST -H "Content-Type: application/json" -d @seed_data.json http://localhost:3001/api/import-sentences

```

## 6. Build Web Expo dan Deploy ke Express

Langkah ini untuk merubah kode Expo menjadi file web statis dan memindahkannya ke folder public milik server Express.

```bash
cd ~/video-collect-dataset/mobile-app

# Hapus folder build lama agar bersih
rm -rf dist

# Buat build web baru
npx expo export --platform web

# Kembali ke root folder
cd ..

# Hapus folder public lama di server agar tidak menumpuk/bentrok
rm -rf server/public

# Pindahkan folder 'dist' ke 'server' dan ubah namanya menjadi 'public'
mv mobile-app/dist server/public

# Cek apakah file berhasil dipindahkan (harus muncul file index.html, favicon, dll)
ls -F server/public/

# Restart PM2 agar server Express memuat tampilan web terbaru
pm2 restart 0

```


> **Catatan Penting:** Jika Anda mem-build ulang aplikasi web, data storage lokal di browser pengguna (seperti antrean rekaman yang belum di-upload) bisa terhapus. Pastikan proses build ke server hanya dilakukan ketika tahap *development* sudah selesai, atau ketika data *queue* sedang kosong.

