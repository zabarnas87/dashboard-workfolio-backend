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

// 1. RUTE UTAMA (Hanya untuk penanda server aktif)
app.get('/', (req, res) => {
    res.json({ message: 'Dashboard API is running!', status: 'Online' });
});

// Database Connection Configuration (Pool untuk stabilitas di Vercel)
const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'db_dashboard_corporate',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    connectTimeout: 10000
};

const db = mysql.createPool(dbConfig);

// Helper: Query Pool
const poolQuery = (sql, params) => {
    return new Promise((resolve, reject) => {
        db.query(sql, params, (err, results) => {
            if (err) reject(err);
            else resolve(results);
        });
    });
};

// DEBUG ENDPOINT: Cek Koneksi DB dari Vercel
app.get('/api/debug-db', (req, res) => {
    db.getConnection((err, connection) => {
        if (err) {
            return res.json({
                status: 'error',
                message: err.message,
                code: err.code,
                config: { ...dbConfig, password: '***' }
            });
        }
        res.json({ status: 'success', message: 'Database Connected Successfully!' });
        connection.release();
    });
});

// GET: Ambil daftar data TJSL
app.get('/api/tjsl', (req, res) => {
    const sql = 'SELECT id, tanggal_pengajuan, tanggal_penyerahan, instansi, kegiatan, jenis_bantuan, nominal, keterangan FROM tjsl_submissions ORDER BY id DESC';
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        
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

// LOGIN API
app.post('/api/login', (req, res) => {
    const { nik, pass } = req.body;
    const sql = 'SELECT id, name, nik, role, status FROM users WHERE nik = ? AND pass = ?';
    db.query(sql, [nik, pass], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        if (results.length > 0) {
            const user = results[0];
            if (user.status !== 'Accepted') {
                return res.status(403).json({ error: 'Maaf akun anda belum di verifikasi admin' });
            }
            res.json(user);
        } else {
            res.status(401).json({ error: 'NIK atau Password salah!' });
        }
    });
});

// REGISTER API
app.post('/api/users', (req, res) => {
    const { name, nik, pass, role } = req.body;
    const sql = 'INSERT INTO users (name, nik, pass, role, status) VALUES (?, ?, ?, ?, ?)';
    db.query(sql, [name, nik, pass, role || 'User', 'Pending'], (err, result) => {
        if (err) {
            if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'NIK sudah terdaftar!' });
            return res.status(500).json({ error: err.message });
        }
        res.json({ id: result.insertId, message: 'Registrasi berhasil, tunggu verifikasi admin' });
    });
});

// USERS LIST (Admin Only)
app.get('/api/users', (req, res) => {
    db.query('SELECT id, name, nik, role, status, created_at FROM users ORDER BY created_at DESC', (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// UPDATE USER STATUS
app.put('/api/users/:id/status', (req, res) => {
    const { status } = req.body;
    db.query('UPDATE users SET status = ? WHERE id = ?', [status, req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Status updated' });
    });
});

// DELETE USER
app.delete('/api/users/:id', (req, res) => {
    db.query('DELETE FROM users WHERE id = ?', [req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'User deleted' });
    });
});

// Export app for Vercel
module.exports = app;

// For local development
if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`Server running locally on port ${PORT}`);
    });
}
