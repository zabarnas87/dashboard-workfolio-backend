const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

// 1. RUTE UTAMA (Harus Paling Atas)
app.get('/', (req, res) => {
    res.sendFile(path.resolve(__dirname, '../index.html'));
});

// 2. SERVE FILES (Akses folder fisik)
app.use(express.static(path.resolve(__dirname, '../')));
app.use('/uploads', express.static(path.resolve(__dirname, 'uploads')));

// Database Connection Configuration (Using Pool for stability on Vercel)
const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'db_dashboard_corporate',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
};

const db = mysql.createPool(dbConfig);

// Helper function to query the pool
const query = (sql, params) => {
    return new Promise((resolve, reject) => {
        db.query(sql, params, (err, results) => {
            if (err) reject(err);
            else resolve(results);
        });
    });
};

console.log('Database Pool Initialized! ⚡');

    // Auto-Create Database (Only if not using a managed DB that already exists)
    const dbName = process.env.DB_NAME || 'db_dashboard_corporate';
    db.query(`CREATE DATABASE IF NOT EXISTS ${dbName}`, (err) => {
        if (err) {
            console.error('Error creating database (may not have permission on cloud):', err.message);
            // On some cloud DBs, we can't create DBs, so we just try to USE it
        }
        
        db.query(`USE ${dbName}`, (err) => {
            if (err) {
                console.error('CRITICAL: Error selecting database:', err);
                return;
            }

            // Auto-Create TJSL Table
            const createTJSLTableSql = `
                CREATE TABLE IF NOT EXISTS tjsl_submissions (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    tanggal_pengajuan DATE,
                    tanggal_penyerahan DATE,
                    instansi VARCHAR(255),
                    kegiatan VARCHAR(255),
                    jenis_bantuan VARCHAR(100),
                    nominal BIGINT,
                    keterangan TEXT,
                    doc_transfer LONGTEXT,
                    doc_kwitansi LONGTEXT,
                    doc_serah_terima LONGTEXT,
                    doc_pengajuan LONGTEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )`;
            
            // Auto-Create Users Table
            const createUsersTableSql = `
                CREATE TABLE IF NOT EXISTS users (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    name VARCHAR(255),
                    nik VARCHAR(50) UNIQUE,
                    pass VARCHAR(255),
                    role VARCHAR(50) DEFAULT 'User',
                    status VARCHAR(50) DEFAULT 'Pending',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )`;
            
            db.query(createTJSLTableSql, (err) => {
                if (err) console.error('Error creating TJSL table:', err);
                else console.log('TJSL Table ready! ✅');
            });

            db.query(createUsersTableSql, (err) => {
                if (err) console.error('Error creating Users table:', err);
                else {
                    console.log('Users Table ready! ✅');
                    // ... rest of the logic
                }
            });
        });
    });
});

// DEBUG ENDPOINT: Cek Koneksi DB dari Vercel
app.get('/api/debug-db', (req, res) => {
    const testDb = mysql.createConnection(dbConfig);
    testDb.connect((err) => {
        if (err) {
            return res.json({
                status: 'error',
                message: err.message,
                code: err.code,
                config: { ...dbConfig, password: '***' }
            });
        }
        res.json({ status: 'success', message: 'Connected to Database!' });
        testDb.end();
    });
});

// Helper: Save Base64 to File
function saveBase64Image(base64Data, year, activity, docType) {
    try {
        // Jika datanya bukan base64 (misal placeholder atau sudah berupa path), skip
        if (!base64Data || !base64Data.startsWith('data:')) {
            return base64Data; 
        }

        console.log(`Processing file: ${docType} for ${activity} (${year})`);

        // Bersihkan nama kegiatan untuk folder (hapus karakter aneh)
        const safeActivity = activity.replace(/[/\\?%*:|"<>]/g, '-');
        const uploadDir = path.join(__dirname, 'uploads', 'TJSL', year.toString(), safeActivity);
        
        // Buat folder jika belum ada (recursive)
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }

        // Extract tipe mime dan data murni (Support image dan application/pdf)
        const matches = base64Data.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-+.]+);base64,(.+)$/);
        if (!matches || matches.length !== 3) return base64Data;

        const mimeType = matches[1];
        const data = matches[2];
        const buffer = Buffer.from(data, 'base64');
        
        // Tentukan ekstensi file
        let extension = 'bin';
        if (mimeType.includes('pdf')) extension = 'pdf';
        else if (mimeType.includes('jpeg')) extension = 'jpg';
        else if (mimeType.includes('png')) extension = 'png';
        else if (mimeType.includes('jpg')) extension = 'jpg';
        
        const fileName = `${docType}.${extension}`;
        const filePath = path.join(uploadDir, fileName);
        
        fs.writeFileSync(filePath, buffer);
        console.log(`✅ File saved successfully: ${filePath}`);
        
        // Return URL relatif agar frontend bisa menambahkan API_BASE_URL dinamis
        return `/uploads/TJSL/${year}/${safeActivity}/${fileName}`;
    } catch (error) {
        console.error(`❌ Error saving file ${docType}:`, error);
        return base64Data; // Balikkan original jika gagal biar data tetap ada di DB (base64)
    }
}

// GET: Ambil daftar data TJSL (Tanpa foto supaya enteng)
app.get('/api/tjsl', (req, res) => {
    const sql = 'SELECT id, tanggal_pengajuan, tanggal_penyerahan, instansi, kegiatan, jenis_bantuan, nominal, keterangan FROM tjsl_submissions ORDER BY id DESC';
    db.query(sql, (err, results) => {
        if (err) return res.status(500).send(err);
        
        const data = results.map(row => ({
            id: row.id,
            tanggalPengajuan: row.tanggal_pengajuan,
            tanggalPenyerahan: row.tanggal_penyerahan,
            instansi: row.instansi,
            kegiatan: row.kegiatan,
            jenisBantuan: row.jenis_bantuan,
            nominal: row.nominal,
            keterangan: row.keterangan
        }));
        res.json(data);
    });
});

// GET: Ambil detail lengkap (termasuk foto) berdasarkan ID
app.get('/api/tjsl/:id', (req, res) => {
    const sql = 'SELECT * FROM tjsl_submissions WHERE id = ?';
    db.query(sql, [req.params.id], (err, results) => {
        if (err || results.length === 0) return res.status(404).json({ message: 'Not found' });
        
        const row = results[0];
        const data = {
            id: row.id,
            tanggalPengajuan: row.tanggal_pengajuan,
            tanggalPenyerahan: row.tanggal_penyerahan,
            instansi: row.instansi,
            kegiatan: row.kegiatan,
            jenisBantuan: row.jenis_bantuan,
            nominal: row.nominal,
            keterangan: row.keterangan,
            docs: {
                transfer: row.doc_transfer,
                kwitansi: row.doc_kwitansi,
                serahTerima: row.doc_serah_terima,
                pengajuan: row.doc_pengajuan
            }
        };
        res.json(data);
    });
});

// POST: Simpan data TJSL baru + Simpan File
app.post('/api/tjsl', (req, res) => {
    const d = req.body;
    const year = new Date(d.tanggalPengajuan).getFullYear();
    
    // Simpan file ke folder fisik
    const pathTransfer = saveBase64Image(d.docs.transfer, year, d.kegiatan, 'bukti_transfer');
    const pathKwitansi = saveBase64Image(d.docs.kwitansi, year, d.kegiatan, 'kwitansi');
    const pathSerahTerima = saveBase64Image(d.docs.serahTerima, year, d.kegiatan, 'serah_terima');
    const pathPengajuan = saveBase64Image(d.docs.pengajuan, year, d.kegiatan, 'pengajuan');

    const sql = `INSERT INTO tjsl_submissions 
        (tanggal_pengajuan, tanggal_penyerahan, instansi, kegiatan, jenis_bantuan, nominal, keterangan, doc_transfer, doc_kwitansi, doc_serah_terima, doc_pengajuan) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    
    const values = [
        d.tanggalPengajuan,
        d.tanggalPenyerahan,
        d.instansi,
        d.kegiatan,
        d.jenisBantuan,
        d.nominal,
        d.keterangan,
        pathTransfer,
        pathKwitansi,
        pathSerahTerima,
        pathPengajuan
    ];

    db.query(sql, values, (err, result) => {
        if (err) return res.status(500).send(err);
        res.json({ message: 'Success', id: result.insertId });
    });
});

// DELETE: Hapus data TJSL
app.delete('/api/tjsl/:id', (req, res) => {
    const sql = 'DELETE FROM tjsl_submissions WHERE id = ?';
    db.query(sql, [req.params.id], (err, result) => {
        if (err) return res.status(500).send(err);
        res.json({ message: 'Deleted successfully' });
    });
});

// PUT: Update data TJSL + Simpan File Baru
app.put('/api/tjsl/:id', (req, res) => {
    const id = req.params.id;
    const d = req.body;
    const year = new Date(d.tanggalPengajuan).getFullYear();

    // Simpan file ke folder fisik
    const pathTransfer = saveBase64Image(d.docs.transfer, year, d.kegiatan, 'bukti_transfer');
    const pathKwitansi = saveBase64Image(d.docs.kwitansi, year, d.kegiatan, 'kwitansi');
    const pathSerahTerima = saveBase64Image(d.docs.serahTerima, year, d.kegiatan, 'serah_terima');
    const pathPengajuan = saveBase64Image(d.docs.pengajuan, year, d.kegiatan, 'pengajuan');

    const sql = `UPDATE tjsl_submissions SET 
        tanggal_pengajuan = ?, 
        tanggal_penyerahan = ?, 
        instansi = ?, 
        kegiatan = ?, 
        jenis_bantuan = ?, 
        nominal = ?, 
        keterangan = ?, 
        doc_transfer = ?, 
        doc_kwitansi = ?, 
        doc_serah_terima = ?, 
        doc_pengajuan = ? 
        WHERE id = ?`;
    
    const values = [
        d.tanggalPengajuan,
        d.tanggalPenyerahan,
        d.instansi,
        d.kegiatan,
        d.jenisBantuan,
        d.nominal,
        d.keterangan,
        pathTransfer,
        pathKwitansi,
        pathSerahTerima,
        pathPengajuan,
        id
    ];

    db.query(sql, values, (err, result) => {
        if (err) return res.status(500).send(err);
        res.json({ message: 'Updated successfully' });
    });
});

// ================= USER MANAGEMENT API =================

// Debug route to view raw database content
app.get('/api/debug-db', (req, res) => {
    db.query('SELECT * FROM tjsl_submissions ORDER BY tanggal_pengajuan DESC', (err, results) => {
        if (err) return res.status(500).json({ error: 'Database query failed', details: err.message });
        res.json(results);
    });
});

// Get all users
app.get('/api/users', (req, res) => {
    db.query('SELECT id, name, nik, role, status, created_at FROM users ORDER BY created_at DESC', (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// Register new user
app.post('/api/users', (req, res) => {
    const { name, nik, pass, role } = req.body;
    const sql = 'INSERT INTO users (name, nik, pass, role) VALUES (?, ?, ?, ?)';
    db.query(sql, [name, nik, pass, role || 'User'], (err, result) => {
        if (err) {
            if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'NIK sudah terdaftar!' });
            return res.status(500).json({ error: err.message });
        }
        res.json({ id: result.insertId, message: 'User berhasil didaftarkan' });
    });
});

// Login check
app.post('/api/login', (req, res) => {
    const { nik, pass } = req.body;
    db.query('SELECT * FROM users WHERE nik = ? AND pass = ?', [nik, pass], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        if (results.length > 0) {
            const user = results[0];
            
            // CEK STATUS VERIFIKASI
            if (user.status !== 'Accepted') {
                return res.status(403).json({ error: 'Maaf akun anda belum di verifikasi admin' });
            }

            delete user.pass; // Jangan kirim password balik
            res.json(user);
        } else {
            res.status(401).json({ error: 'NIK atau Password salah!' });
        }
    });
});

// Update user status (Accept/Reject)
app.put('/api/users/:id/status', (req, res) => {
    const { status } = req.body;
    db.query('UPDATE users SET status = ? WHERE id = ?', [status, req.params.id], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: `User status updated to ${status}` });
    });
});

// Delete user
app.delete('/api/users/:id', (req, res) => {
    db.query('DELETE FROM users WHERE id = ?', [req.params.id], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'User berhasil dihapus' });
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`==========================================`);
    console.log(`   API SERVER DASHBOARD AKTIF! ✅`);
    console.log(`   Port: ${PORT}`);
    console.log(`   Akses Lokal: http://localhost:${PORT}`);
    console.log(`   Akses Jaringan: Cek IP Laptop Anda`);
    console.log(`==========================================`);
});
