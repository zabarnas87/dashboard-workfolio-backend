const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

// Database Config
const dbConfig = {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    connectTimeout: 10000,
    ssl: {
        rejectUnauthorized: false // Diperlukan untuk cloud DB seperti Aiven
    }
};

// Helper: Fungsi untuk menjalankan Query dengan koneksi baru setiap kali
const executeQuery = (sql, params) => {
    return new Promise((resolve, reject) => {
        const connection = mysql.createConnection(dbConfig);
        connection.connect((err) => {
            if (err) return reject(err);
            connection.query(sql, params, (err, results) => {
                connection.end(); // Langsung putus setelah selesai
                if (err) reject(err);
                else resolve(results);
            });
        });
    });
};

app.get('/', (req, res) => res.send('API Active'));

// INIT DATABASE API (Sekali jalan buat bikin tabel di Aiven)
app.get('/api/init-db', async (req, res) => {
    try {
        const createUsersTable = `
            CREATE TABLE IF NOT EXISTS users (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(255),
                nik VARCHAR(50) UNIQUE,
                pass VARCHAR(255),
                role VARCHAR(50) DEFAULT 'User',
                status VARCHAR(50) DEFAULT 'Pending',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`;
        
        const createTJSLTable = `
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

        const insertAdmin = `
            INSERT INTO users (name, nik, pass, role, status) 
            VALUES ('Reza Barnas', '1900952', '123456', 'Admin', 'Accepted')
            ON DUPLICATE KEY UPDATE role='Admin', status='Accepted'`;

        await executeQuery(createUsersTable, []);
        await executeQuery(createTJSLTable, []);
        await executeQuery(insertAdmin, []);

        res.json({ message: 'Database Aiven Berhasil di-Inisialisasi! ✅' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// LOGIN API
app.post('/api/login', async (req, res) => {
    const { nik, pass } = req.body;
    try {
        const sql = 'SELECT id, name, nik, role, status FROM users WHERE nik = ? AND pass = ?';
        const results = await executeQuery(sql, [nik, pass]);
        
        if (results.length > 0) {
            const user = results[0];
            if (user.status !== 'Accepted') {
                return res.status(403).json({ error: 'Maaf akun anda belum di verifikasi admin' });
            }
            res.json(user);
        } else {
            res.status(401).json({ error: 'NIK atau Password salah!' });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET TJSL API
app.get('/api/tjsl', async (req, res) => {
    try {
        const sql = 'SELECT id, tanggal_pengajuan, tanggal_penyerahan, instansi, kegiatan, jenis_bantuan, nominal, keterangan FROM tjsl_submissions ORDER BY id DESC';
        const results = await executeQuery(sql, []);
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
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Export untuk Vercel
module.exports = app;
