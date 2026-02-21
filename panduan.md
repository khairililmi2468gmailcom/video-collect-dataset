Panduan Deployment (Web & Server)
Supaya aplikasi web jalan langsung dari Express (tidak perlu pakai expo start terus-menerus), maka harus mem-build web tersebut dan menaruhnya di folder public server Anda.
# Seed data json ke database
curl -X POST -H "Content-Type: application/json" -d @seed_data.json http://localhost:3001/api/import-sentences

# Langkah 1: Build Web Expo
cd ~/video-collect-dataset/mobile-app
npx expo export -p web
(Perintah ini akan membuat folder dist di dalam mobile-app yang berisi file HTML/JS statis hasil build).

# Langkah 2: Pindahkan Hasil Build ke Server
## Hapus isi folder public lama (jika ada) dan salin yang baru
rm -rf ../server/public/*
cp -r dist/* ../server/public/

# Langkah 3: Restart PM2 Server
Karena server bertugas menyajikan API dan sekaligus me-render web di port 3001:
cd ../server
pm2 restart video-api


note: jika di build ulang data yang disimpan di storage browser akan terhapus. Jadi pastika build jika sudah selesai mode development 