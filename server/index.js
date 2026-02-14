const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs-extra');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: '50mb' })); 

// --- 1. SETUP DATABASE SQLITE ---
const dbPath = path.resolve(__dirname, 'dataset.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) console.error('Error opening database:', err.message);
    else console.log('✅ Connected to SQLite database.');
});

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS sentences (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        text TEXT NOT NULL,
        category TEXT
    )`);
});

// --- 2. CONFIG UPLOAD VIDEO ---
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    // Note: Agar req.body terisi, di Frontend field teks harus di-append SEBELUM file video
    let { userName, userGender, userAge } = req.body;
    
    // Fallback jika undefined (jaga-jaga)
    userName = userName || 'Anonymous';
    userGender = userGender || 'Unknown';
    userAge = userAge || '0';

    const safeName = userName.replace(/[^a-z0-9]/gi, '_');
    const folderName = `${safeName}_${userGender}_${userAge}`;
    
    // Simpan di folder: uploads/Nama_Gender_Umur/
    const dir = path.join(__dirname, 'uploads', folderName);
    
    try {
        await fs.ensureDir(dir);
        cb(null, dir);
    } catch (e) {
        cb(e, null);
    }
  },
  filename: (req, file, cb) => {
    const { sentenceId } = req.body;
    // Nama file: rec_ID_Timestamp.mp4
    cb(null, `rec_${sentenceId || '0'}_${Date.now()}.mp4`);
  }
});

const upload = multer({ storage: storage });

// --- 3. API ENDPOINTS ---

app.get('/api/sentences', (req, res) => {
    const limit = req.query.limit || 5; 
    db.all(`SELECT * FROM sentences ORDER BY RANDOM() LIMIT ?`, [limit], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/import-sentences', (req, res) => {
    const sentences = req.body;
    if (!Array.isArray(sentences)) return res.status(400).json({ error: "Harus array JSON" });

    const stmt = db.prepare("INSERT INTO sentences (text, category) VALUES (?, ?)");
    db.serialize(() => {
        db.run("BEGIN TRANSACTION");
        sentences.forEach(item => stmt.run(item.text, item.category || 'General'));
        db.run("COMMIT", (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: `Import ${sentences.length} kalimat sukses.` });
        });
    });
    stmt.finalize();
});

// C. Upload Video & Simpan Teks
app.post('/api/upload', upload.single('video'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: "Tidak ada file video yang diupload" });
        }

        console.log(`📹 Video diterima: ${req.file.path}`);

        // --- SIMPAN FILE TEKS (.txt) ---
        // Kita ambil teks kalimat dari body yang dikirim frontend
        const { sentenceText } = req.body;
        
        if (sentenceText) {
            // Buat path file .txt sama persis dengan path video, cuma beda ekstensi
            const txtPath = req.file.path.replace('.mp4', '.txt');
            
            // Tulis file teks
            await fs.writeFile(txtPath, sentenceText);
            console.log(`📝 Teks disimpan: ${txtPath}`);
        }

        res.json({ status: 'ok', path: req.file.path });
    } catch (error) {
        console.error("Upload Error:", error);
        res.status(500).json({ error: "Gagal memproses upload" });
    }
});


// A. Beritahu Express folder 'public' berisi file statis (HTML/JS/CSS)
app.use(express.static(path.join(__dirname, 'public')));

// B. "Catch-All" Route:
// Jika user buka link sembarang (misal /profile, /record) yang bukan API,
// kirimkan file index.html milik Web App.
// Ini penting agar React Router di Web berfungsi saat di-refresh.
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = 3001;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on http://0.0.0.0:${PORT}`);
});