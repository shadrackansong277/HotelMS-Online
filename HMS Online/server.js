'use strict';

const express      = require('express');
const session      = require('express-session');
const rateLimit    = require('express-rate-limit');
const bcrypt       = require('bcryptjs');
const { v4: uuid } = require('uuid');
const initSqlJs    = require('sql.js');
const path         = require('path');
const fs           = require('fs');

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const PORT         = process.env.PORT         || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'hms-change-this-secret-in-production';
// On Render with a persistent disk, DATA_DIR is /data (see render.yaml)
// Locally it falls back to ./data
const DATA_DIR = process.env.DATA_DIR || (process.env.RENDER ? '/data' : path.join(__dirname, 'data'));
const DB_FILE      = path.join(DATA_DIR, 'hms.db');
const NODE_ENV     = process.env.NODE_ENV     || 'development';

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ─── DATABASE ────────────────────────────────────────────────────────────────
let db;

async function initDB() {
  const SQL = await initSqlJs();
  try {
    db = fs.existsSync(DB_FILE)
      ? new SQL.Database(fs.readFileSync(DB_FILE))
      : new SQL.Database();
  } catch (e) {
    console.error('DB load error, starting fresh:', e.message);
    db = new SQL.Database();
  }
  createSchema();
  seedDefaults();
  saveDB();
  console.log('✓ Database ready at', DB_FILE);
}

function saveDB() {
  try { fs.writeFileSync(DB_FILE, Buffer.from(db.export())); }
  catch (e) { console.error('DB save error:', e.message); }
}

function createSchema() {
  db.run(`
    CREATE TABLE IF NOT EXISTS hotels (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, address TEXT DEFAULT '',
      phone TEXT DEFAULT '', email TEXT DEFAULT '', tax_rate REAL DEFAULT 15,
      accent_color TEXT DEFAULT '#C9A84C', bg_color TEXT DEFAULT '#0D0F14',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, hotel_id TEXT NOT NULL,
      username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin','manager','receptionist')),
      full_name TEXT NOT NULL DEFAULT '', email TEXT DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY, hotel_id TEXT NOT NULL,
      room_number TEXT NOT NULL, floor INTEGER NOT NULL DEFAULT 1,
      type TEXT NOT NULL DEFAULT 'Standard', rate REAL NOT NULL DEFAULT 120,
      is_short_stay INTEGER NOT NULL DEFAULT 0,
      short_stay_rate REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'available'
        CHECK(status IN ('available','occupied','housekeeping','reserved')),
      UNIQUE(hotel_id, room_number),
      FOREIGN KEY(hotel_id) REFERENCES hotels(id)
    );
    CREATE TABLE IF NOT EXISTS guests (
      id TEXT PRIMARY KEY, hotel_id TEXT NOT NULL,
      full_name TEXT NOT NULL, email TEXT DEFAULT '',
      phone TEXT DEFAULT '', id_type TEXT DEFAULT '',
      id_number TEXT DEFAULT '', nationality TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY(hotel_id) REFERENCES hotels(id)
    );
    CREATE TABLE IF NOT EXISTS bookings (
      id TEXT PRIMARY KEY, hotel_id TEXT NOT NULL,
      guest_id TEXT NOT NULL, room_id TEXT NOT NULL,
      booking_ref TEXT UNIQUE NOT NULL,
      check_in_date TEXT DEFAULT '', check_out_date TEXT DEFAULT '',
      check_in_time TEXT DEFAULT '', check_out_time TEXT DEFAULT '',
      nights INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'reserved'
        CHECK(status IN ('reserved','checked_in','checked_out','cancelled')),
      is_short_stay INTEGER NOT NULL DEFAULT 0,
      short_stay_minutes INTEGER NOT NULL DEFAULT 60,
      timer_start TEXT DEFAULT NULL, timer_end TEXT DEFAULT NULL,
      room_charge REAL NOT NULL DEFAULT 0, extras REAL NOT NULL DEFAULT 0,
      tax REAL NOT NULL DEFAULT 0, total REAL NOT NULL DEFAULT 0,
      notes TEXT DEFAULT '', created_by TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      deleted INTEGER NOT NULL DEFAULT 0,
      deleted_by TEXT DEFAULT NULL, deleted_at TEXT DEFAULT NULL,
      FOREIGN KEY(hotel_id) REFERENCES hotels(id),
      FOREIGN KEY(guest_id)  REFERENCES guests(id),
      FOREIGN KEY(room_id)   REFERENCES rooms(id)
    );
    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY, hotel_id TEXT NOT NULL,
      user_id TEXT NOT NULL, action TEXT NOT NULL,
      target_type TEXT DEFAULT '', target_id TEXT DEFAULT '',
      details TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_bookings_hotel   ON bookings(hotel_id, deleted);
    CREATE INDEX IF NOT EXISTS idx_bookings_room    ON bookings(room_id, status);
    CREATE INDEX IF NOT EXISTS idx_rooms_hotel      ON rooms(hotel_id);
    CREATE INDEX IF NOT EXISTS idx_audit_hotel      ON audit_log(hotel_id, created_at);
  `);
}

function seedDefaults() {
  const row = db.exec(`SELECT id FROM hotels LIMIT 1`);
  if (row.length && row[0].values.length) return;

  const hid = uuid();
  db.run(`INSERT INTO hotels (id,name,address,phone,email) VALUES (?,?,?,?,?)`,
    [hid, 'Grand Vista Hotel', '123 Cantonments Rd, Accra', '0302123456', 'info@grandvista.com']);
  db.run(`INSERT INTO users (id,hotel_id,username,password_hash,role,full_name,email) VALUES (?,?,?,?,?,?,?)`,
    [uuid(), hid, 'admin', bcrypt.hashSync('admin123', 10), 'admin', 'System Admin', 'admin@grandvista.com']);
  db.run(`INSERT INTO users (id,hotel_id,username,password_hash,role,full_name) VALUES (?,?,?,?,?,?)`,
    [uuid(), hid, 'manager', bcrypt.hashSync('manager123', 10), 'manager', 'Hotel Manager']);
  db.run(`INSERT INTO users (id,hotel_id,username,password_hash,role,full_name) VALUES (?,?,?,?,?,?)`,
    [uuid(), hid, 'receptionist', bcrypt.hashSync('recept123', 10), 'receptionist', 'Front Desk']);

  const types = ['Standard','Standard','Deluxe','Deluxe','Suite','Suite'];
  const rates  = [120, 120, 180, 180, 280, 280];
  for (let f = 1; f <= 5; f++) {
    for (let r = 1; r <= 6; r++) {
      const isShort = (r === 6 && f <= 3) ? 1 : 0;
      db.run(`INSERT OR IGNORE INTO rooms (id,hotel_id,room_number,floor,type,rate,is_short_stay,short_stay_rate,status) VALUES (?,?,?,?,?,?,?,?,?)`,
        [uuid(), hid, `${f}0${r}`, f,
         isShort ? 'Short Stay' : types[(r-1) % 6],
         isShort ? 40 : rates[(r-1) % 6],
         isShort, isShort ? 40 : 0, 'available']);
    }
  }
  saveDB();
  console.log('✓ Seeded default hotel, users and rooms');
}

// ─── DB HELPERS ──────────────────────────────────────────────────────────────
function q(sql, params = []) {
  try {
    const res = db.exec(sql, params);
    if (!res.length) return [];
    return res[0].values.map(row => {
      const o = {};
      res[0].columns.forEach((c, i) => o[c] = row[i]);
      return o;
    });
  } catch (e) {
    console.error('SQL ERR:', e.message, '\n', sql);
    return [];
  }
}

function run(sql, params = []) {
  try {
    db.run(sql, params);
    saveDB();
    return { ok: true };
  } catch (e) {
    console.error('RUN ERR:', e.message);
    return { ok: false, error: e.message };
  }
}

function audit(hotelId, userId, action, targetType, targetId, details = '') {
  run(`INSERT INTO audit_log (id,hotel_id,user_id,action,target_type,target_id,details) VALUES (?,?,?,?,?,?,?)`,
    [uuid(), hotelId, userId, action, targetType, targetId, details]);
}

function upsertGuest(hotelId, g) {
  const email = (g.email || '').trim().toLowerCase();
  const existing = email
    ? q(`SELECT id FROM guests WHERE email=? AND hotel_id=?`, [email, hotelId])
    : [];
  if (existing.length) {
    run(`UPDATE guests SET full_name=?,phone=?,id_type=?,id_number=?,nationality=? WHERE id=?`,
      [g.full_name.trim(), g.phone||'', g.id_type||'', g.id_number||'', g.nationality||'', existing[0].id]);
    return existing[0].id;
  }
  const id = uuid();
  run(`INSERT INTO guests (id,hotel_id,full_name,email,phone,id_type,id_number,nationality) VALUES (?,?,?,?,?,?,?,?)`,
    [id, hotelId, g.full_name.trim(), email, g.phone||'', g.id_type||'', g.id_number||'', g.nationality||'']);
  return id;
}

function calcCharges(hotelId, roomId, nights, isShortStay, shortStayMinutes, extras) {
  const hotel = q(`SELECT tax_rate FROM hotels WHERE id=?`, [hotelId])[0];
  const room  = q(`SELECT rate, short_stay_rate FROM rooms WHERE id=?`, [roomId])[0];
  if (!hotel || !room) return null;
  const roomCharge = isShortStay ? (room.short_stay_rate || 40) : (room.rate * (nights || 1));
  const extrasAmt  = parseFloat(extras) || 0;
  const taxAmt     = (roomCharge + extrasAmt) * ((hotel.tax_rate || 15) / 100);
  const total      = roomCharge + extrasAmt + taxAmt;
  const timerEnd   = isShortStay
    ? new Date(Date.now() + (shortStayMinutes || 60) * 60000).toISOString()
    : null;
  return { roomCharge, extrasAmt, taxAmt, total, timerEnd };
}

// ─── EXPRESS ─────────────────────────────────────────────────────────────────
const app = express();

app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));

// Sessions — in-memory store (sufficient for single-instance deployments)
// For multi-instance scaling, replace with connect-redis or similar
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  name: 'hms.sid',
  cookie: {
    httpOnly: true,
    // On Render/Railway the app is behind a TLS-terminating proxy.
    // With 'trust proxy' set above, secure:true works correctly.
    secure: NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 8 * 60 * 60 * 1000  // 8 hours
  }
}));

// Rate limit login endpoint
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,   // 15 minutes
  max: 20,
  message: { ok: false, error: 'Too many login attempts. Try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ─── MIDDLEWARE ───────────────────────────────────────────────────────────────
const ROLES = { admin: 3, manager: 2, receptionist: 1 };

function requireAuth(req, res, next) {
  if (!req.session?.user) return res.status(401).json({ ok: false, error: 'Not authenticated' });
  next();
}

function requireRole(minRole) {
  return (req, res, next) => {
    if (!req.session?.user) return res.status(401).json({ ok: false, error: 'Not authenticated' });
    if ((ROLES[req.session.user.role] || 0) < ROLES[minRole])
      return res.status(403).json({ ok: false, error: 'Insufficient permissions' });
    next();
  };
}

function hotelId(req) { return req.session.user.hotel_id; }
function userId(req)  { return req.session.user.id; }

// ─── AUTH ─────────────────────────────────────────────────────────────────────
app.get('/api/hotels', (req, res) => {
  res.json(q(`SELECT id, name FROM hotels ORDER BY name`));
});

app.post('/api/login', loginLimiter, (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.json({ ok: false, error: 'Username and password required' });

  const users = q(`
    SELECT u.*, h.name AS hotel_name, h.accent_color, h.bg_color, h.tax_rate
    FROM users u JOIN hotels h ON u.hotel_id = h.id
    WHERE u.username = ? AND u.active = 1
  `, [username.trim()]);

  if (!users.length) return res.json({ ok: false, error: 'Invalid credentials' });
  const u = users[0];
  if (!bcrypt.compareSync(password, u.password_hash))
    return res.json({ ok: false, error: 'Invalid credentials' });

  delete u.password_hash;
  req.session.user = u;
  req.session.save(err => {
    if (err) return res.json({ ok: false, error: 'Session error' });
    audit(u.hotel_id, u.id, 'LOGIN', 'user', u.id, `IP: ${req.ip}`);
    res.json({ ok: true, user: u });
  });
});

app.post('/api/logout', requireAuth, (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', (req, res) => {
  if (!req.session?.user) return res.json({ ok: false });
  // Refresh user data from DB in case it changed
  const users = q(`
    SELECT u.*, h.name AS hotel_name, h.accent_color, h.bg_color, h.tax_rate
    FROM users u JOIN hotels h ON u.hotel_id = h.id
    WHERE u.id = ? AND u.active = 1
  `, [req.session.user.id]);
  if (!users.length) { req.session.destroy(); return res.json({ ok: false }); }
  delete users[0].password_hash;
  req.session.user = users[0];
  res.json({ ok: true, user: users[0] });
});

// ─── HOTELS ──────────────────────────────────────────────────────────────────
app.get('/api/hotels/all', requireRole('admin'), (req, res) => {
  res.json(q(`SELECT * FROM hotels ORDER BY name`));
});

app.post('/api/hotels', requireRole('admin'), (req, res) => {
  const { name, address, phone, email, adminUser, adminPass } = req.body;
  if (!name?.trim()) return res.json({ ok: false, error: 'Hotel name required' });
  if (!adminUser?.trim()) return res.json({ ok: false, error: 'Admin username required' });
  if (!adminPass || adminPass.length < 6) return res.json({ ok: false, error: 'Password min 6 chars' });
  if (q(`SELECT id FROM users WHERE username=?`, [adminUser.trim()]).length)
    return res.json({ ok: false, error: 'Username already exists' });

  const hid = uuid();
  const r = run(`INSERT INTO hotels (id,name,address,phone,email) VALUES (?,?,?,?,?)`,
    [hid, name.trim(), address||'', phone||'', email||'']);
  if (!r.ok) return res.json(r);

  run(`INSERT INTO users (id,hotel_id,username,password_hash,role,full_name) VALUES (?,?,?,?,?,?)`,
    [uuid(), hid, adminUser.trim(), bcrypt.hashSync(adminPass, 10), 'admin', name.trim() + ' Admin']);

  audit(hotelId(req), userId(req), 'ADD_HOTEL', 'hotel', hid, name.trim());
  res.json({ ok: true, hotelId: hid });
});

app.put('/api/hotels/:id', requireRole('admin'), (req, res) => {
  const { name, address, phone, email, tax_rate, accent_color, bg_color } = req.body;
  if (!name?.trim()) return res.json({ ok: false, error: 'Hotel name required' });
  if (req.params.id !== hotelId(req) && req.session.user.role !== 'admin')
    return res.status(403).json({ ok: false, error: 'Forbidden' });

  const r = run(`UPDATE hotels SET name=?,address=?,phone=?,email=?,tax_rate=?,accent_color=?,bg_color=? WHERE id=?`,
    [name.trim(), address||'', phone||'', email||'',
     parseFloat(tax_rate)||15, accent_color||'#C9A84C', bg_color||'#0D0F14', req.params.id]);

  if (r.ok) {
    // Sync session hotel_name so sidebar updates
    if (req.params.id === req.session.user.hotel_id) req.session.user.hotel_name = name.trim();
    audit(hotelId(req), userId(req), 'UPDATE_HOTEL', 'hotel', req.params.id);
  }
  res.json(r);
});

// ─── ROOMS ────────────────────────────────────────────────────────────────────
app.get('/api/rooms', requireAuth, (req, res) => {
  res.json(q(`
    SELECT r.*,
           b.id AS active_booking_id, b.timer_end,
           b.is_short_stay AS booking_short,
           g.full_name AS current_guest
    FROM rooms r
    LEFT JOIN bookings b ON b.room_id = r.id AND b.status = 'checked_in' AND b.deleted = 0
    LEFT JOIN guests g ON b.guest_id = g.id
    WHERE r.hotel_id = ?
    ORDER BY r.floor, r.room_number
  `, [hotelId(req)]));
});

app.post('/api/rooms', requireRole('admin'), (req, res) => {
  const { roomNumber, floor, type, rate, isShortStay, shortStayRate } = req.body;
  const rn = (roomNumber || '').trim();
  if (!rn) return res.json({ ok: false, error: 'Room number required' });
  const rr = parseFloat(rate);
  if (!rr || rr <= 0) return res.json({ ok: false, error: 'Valid rate required (must be > 0)' });
  if (isShortStay && (!parseFloat(shortStayRate) || parseFloat(shortStayRate) <= 0))
    return res.json({ ok: false, error: 'Short stay rate required when short stay is enabled' });
  if (q(`SELECT id FROM rooms WHERE hotel_id=? AND room_number=?`, [hotelId(req), rn]).length)
    return res.json({ ok: false, error: `Room ${rn} already exists` });

  const rid = uuid();
  const r = run(`INSERT INTO rooms (id,hotel_id,room_number,floor,type,rate,is_short_stay,short_stay_rate,status) VALUES (?,?,?,?,?,?,?,?,?)`,
    [rid, hotelId(req), rn, parseInt(floor)||1, type||'Standard',
     rr, isShortStay?1:0, isShortStay?parseFloat(shortStayRate):0, 'available']);

  if (r.ok) audit(hotelId(req), userId(req), 'ADD_ROOM', 'room', rid, `Room ${rn}`);
  res.json(r);
});

app.put('/api/rooms/:id', requireRole('admin'), (req, res) => {
  const { roomNumber, floor, type, rate, isShortStay, shortStayRate, status } = req.body;

  // Status-only update (housekeeping mark clean)
  if (status !== undefined && roomNumber === undefined) {
    const valid = ['available','occupied','housekeeping','reserved'];
    if (!valid.includes(status)) return res.json({ ok:false, error:'Invalid status' });
    return res.json(run(`UPDATE rooms SET status=? WHERE id=? AND hotel_id=?`,
      [status, req.params.id, hotelId(req)]));
  }

  const rn = (roomNumber || '').trim();
  if (!rn) return res.json({ ok: false, error: 'Room number required' });
  const rr = parseFloat(rate);
  if (!rr || rr <= 0) return res.json({ ok: false, error: 'Valid rate required' });
  if (isShortStay && (!parseFloat(shortStayRate) || parseFloat(shortStayRate) <= 0))
    return res.json({ ok: false, error: 'Short stay rate required' });

  const r = run(`UPDATE rooms SET room_number=?,floor=?,type=?,rate=?,is_short_stay=?,short_stay_rate=? WHERE id=? AND hotel_id=?`,
    [rn, parseInt(floor)||1, type||'Standard', rr,
     isShortStay?1:0, isShortStay?parseFloat(shortStayRate):0,
     req.params.id, hotelId(req)]);

  if (r.ok) audit(hotelId(req), userId(req), 'EDIT_ROOM', 'room', req.params.id, `Room ${rn}`);
  res.json(r);
});

app.delete('/api/rooms/:id', requireRole('admin'), (req, res) => {
  const active = q(`SELECT id FROM bookings WHERE room_id=? AND status IN ('reserved','checked_in') AND deleted=0`,
    [req.params.id]);
  if (active.length)
    return res.json({ ok: false, error: 'Cannot delete — room has active bookings' });

  const r = run(`DELETE FROM rooms WHERE id=? AND hotel_id=?`, [req.params.id, hotelId(req)]);
  if (r.ok) audit(hotelId(req), userId(req), 'DELETE_ROOM', 'room', req.params.id);
  res.json(r);
});

app.post('/api/rooms/:id/clean', requireAuth, (req, res) => {
  const r = run(`UPDATE rooms SET status='available' WHERE id=? AND hotel_id=?`,
    [req.params.id, hotelId(req)]);
  if (r.ok) audit(hotelId(req), userId(req), 'ROOM_CLEANED', 'room', req.params.id, 'Marked clean');
  res.json(r);
});

// ─── BOOKINGS ────────────────────────────────────────────────────────────────
app.get('/api/bookings', requireAuth, (req, res) => {
  const inc = req.query.includeDeleted === 'true';
  const del = inc ? '' : 'AND b.deleted = 0';
  res.json(q(`
    SELECT b.*,
           g.full_name AS guest_name, g.phone AS guest_phone, g.email AS guest_email,
           r.room_number, r.type AS room_type,
           h.name AS hotel_name, h.tax_rate,
           u.full_name AS created_by_name
    FROM bookings b
    JOIN guests  g ON b.guest_id  = g.id
    JOIN rooms   r ON b.room_id   = r.id
    JOIN hotels  h ON b.hotel_id  = h.id
    LEFT JOIN users u ON b.created_by = u.id
    WHERE b.hotel_id = ? ${del}
    ORDER BY b.created_at DESC
  `, [hotelId(req)]));
});

app.get('/api/bookings/all', requireRole('admin'), (req, res) => {
  res.json(q(`
    SELECT b.*, g.full_name AS guest_name, r.room_number, h.name AS hotel_name
    FROM bookings b
    JOIN guests g ON b.guest_id = g.id
    JOIN rooms  r ON b.room_id  = r.id
    JOIN hotels h ON b.hotel_id = h.id
    WHERE b.deleted = 0
    ORDER BY b.created_at DESC
    LIMIT 200
  `));
});

app.post('/api/bookings', requireAuth, (req, res) => {
  const { guestData, roomId, checkIn, checkOut, nights, isShortStay, shortStayMinutes, notes, extras } = req.body;
  if (!guestData?.full_name?.trim()) return res.json({ ok: false, error: 'Guest name required' });
  if (!roomId) return res.json({ ok: false, error: 'Room required' });
  if (!checkIn) return res.json({ ok: false, error: 'Check-in date required' });

  const room = q(`SELECT id, status FROM rooms WHERE id=? AND hotel_id=?`, [roomId, hotelId(req)])[0];
  if (!room) return res.json({ ok: false, error: 'Room not found' });
  if (room.status !== 'available') return res.json({ ok: false, error: 'Room is not available' });

  const charges = calcCharges(hotelId(req), roomId, nights, isShortStay, shortStayMinutes, extras);
  if (!charges) return res.json({ ok: false, error: 'Could not calculate charges' });

  const guestId = upsertGuest(hotelId(req), guestData);
  const bid = uuid(), ref = 'GVH-' + Date.now().toString().slice(-6);

  const r = run(`
    INSERT INTO bookings
      (id,hotel_id,guest_id,room_id,booking_ref,check_in_date,check_out_date,
       nights,status,is_short_stay,short_stay_minutes,timer_start,timer_end,
       room_charge,extras,tax,total,notes,created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `, [bid, hotelId(req), guestId, roomId, ref, checkIn, checkOut||'',
      nights||1, 'reserved', isShortStay?1:0, shortStayMinutes||0,
      isShortStay ? new Date().toISOString() : null, charges.timerEnd,
      charges.roomCharge, charges.extrasAmt, charges.taxAmt, charges.total,
      (notes||'').trim(), userId(req)]);

  if (r.ok) audit(hotelId(req), userId(req), 'CREATE_BOOKING', 'booking', bid, `Ref: ${ref}`);
  res.json({ ok: r.ok, bookingId: bid, ref, error: r.error });
});

app.post('/api/bookings/walkin', requireAuth, (req, res) => {
  const { guestData, roomId, nights, isShortStay, shortStayMinutes, extras, notes } = req.body;
  if (!guestData?.full_name?.trim()) return res.json({ ok: false, error: 'Guest name required' });
  if (!roomId) return res.json({ ok: false, error: 'Room required' });

  const room = q(`SELECT id, status FROM rooms WHERE id=? AND hotel_id=?`, [roomId, hotelId(req)])[0];
  if (!room) return res.json({ ok: false, error: 'Room not found' });
  if (room.status !== 'available') return res.json({ ok: false, error: 'Room is not available' });

  const charges = calcCharges(hotelId(req), roomId, nights, isShortStay, shortStayMinutes, extras);
  if (!charges) return res.json({ ok: false, error: 'Could not calculate charges' });

  const guestId = upsertGuest(hotelId(req), guestData);
  const bid = uuid(), ref = 'WLK-' + Date.now().toString().slice(-6);
  const now = new Date().toISOString(), today = now.slice(0, 10);

  const r = run(`
    INSERT INTO bookings
      (id,hotel_id,guest_id,room_id,booking_ref,check_in_date,check_out_date,check_in_time,
       nights,status,is_short_stay,short_stay_minutes,timer_start,timer_end,
       room_charge,extras,tax,total,notes,created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `, [bid, hotelId(req), guestId, roomId, ref, today, '', now,
      nights||1, 'checked_in', isShortStay?1:0, shortStayMinutes||0,
      isShortStay ? now : null, charges.timerEnd,
      charges.roomCharge, charges.extrasAmt, charges.taxAmt, charges.total,
      (notes||'').trim(), userId(req)]);

  if (r.ok) {
    run(`UPDATE rooms SET status='occupied' WHERE id=?`, [roomId]);
    audit(hotelId(req), userId(req), 'WALKIN_CHECKIN', 'booking', bid, `Walk-in Ref: ${ref}`);
  }
  res.json({ ok: r.ok, bookingId: bid, ref, error: r.error });
});

app.post('/api/bookings/:id/checkin', requireAuth, (req, res) => {
  const bk = q(`SELECT room_id, status, hotel_id FROM bookings WHERE id=? AND hotel_id=?`,
    [req.params.id, hotelId(req)])[0];
  if (!bk) return res.json({ ok: false, error: 'Booking not found' });
  if (bk.status !== 'reserved') return res.json({ ok: false, error: 'Booking is not in reserved status' });

  const now = new Date().toISOString();
  const r = run(`UPDATE bookings SET status='checked_in', check_in_time=? WHERE id=?`, [now, req.params.id]);
  if (r.ok) {
    run(`UPDATE rooms SET status='occupied' WHERE id=?`, [bk.room_id]);
    audit(hotelId(req), userId(req), 'CHECKIN', 'booking', req.params.id);
  }
  res.json(r);
});

app.post('/api/bookings/:id/checkout', requireAuth, (req, res) => {
  const bk = q(`SELECT room_id, status, hotel_id FROM bookings WHERE id=? AND hotel_id=?`,
    [req.params.id, hotelId(req)])[0];
  if (!bk) return res.json({ ok: false, error: 'Booking not found' });
  if (bk.status !== 'checked_in') return res.json({ ok: false, error: 'Booking is not checked in' });

  const now = new Date().toISOString();
  const r = run(`UPDATE bookings SET status='checked_out', check_out_time=? WHERE id=?`, [now, req.params.id]);
  if (r.ok) {
    run(`UPDATE rooms SET status='housekeeping' WHERE id=?`, [bk.room_id]);
    audit(hotelId(req), userId(req), 'CHECKOUT', 'booking', req.params.id, 'Room sent to housekeeping');
  }
  res.json(r);
});

app.delete('/api/bookings/:id', requireRole('admin'), (req, res) => {
  const bk = q(`SELECT room_id, status FROM bookings WHERE id=? AND hotel_id=?`,
    [req.params.id, hotelId(req)])[0];
  if (!bk) return res.json({ ok: false, error: 'Booking not found' });

  const now = new Date().toISOString();
  const r = run(`UPDATE bookings SET deleted=1, deleted_by=?, deleted_at=? WHERE id=?`,
    [userId(req), now, req.params.id]);
  if (r.ok) {
    if (bk.status === 'checked_in')
      run(`UPDATE rooms SET status='housekeeping' WHERE id=?`, [bk.room_id]);
    audit(hotelId(req), userId(req), 'DELETE_BOOKING', 'booking', req.params.id, 'Hard delete by admin');
  }
  res.json(r);
});

// ─── GUESTS ──────────────────────────────────────────────────────────────────
app.get('/api/guests', requireAuth, (req, res) => {
  res.json(q(`
    SELECT g.*,
           COUNT(b.id)         AS booking_count,
           MAX(b.created_at)   AS last_visit
    FROM guests g
    LEFT JOIN bookings b ON g.id = b.guest_id AND b.deleted = 0
    WHERE g.hotel_id = ?
    GROUP BY g.id
    ORDER BY g.full_name
  `, [hotelId(req)]));
});

// ─── USERS ────────────────────────────────────────────────────────────────────
app.get('/api/users', requireRole('admin'), (req, res) => {
  res.json(q(`
    SELECT id, hotel_id, username, role, full_name, email, active, created_at
    FROM users WHERE hotel_id=? ORDER BY role, full_name
  `, [hotelId(req)]));
});

app.post('/api/users', requireRole('admin'), (req, res) => {
  const { username, password, role, fullName, email } = req.body;
  if (!username?.trim()) return res.json({ ok: false, error: 'Username required' });
  if (!password || password.length < 6) return res.json({ ok: false, error: 'Password min 6 characters' });
  if (!['admin','manager','receptionist'].includes(role))
    return res.json({ ok: false, error: 'Invalid role' });
  if (!fullName?.trim()) return res.json({ ok: false, error: 'Full name required' });
  if (q(`SELECT id FROM users WHERE username=?`, [username.trim()]).length)
    return res.json({ ok: false, error: 'Username already exists' });

  const uid = uuid();
  const r = run(`INSERT INTO users (id,hotel_id,username,password_hash,role,full_name,email) VALUES (?,?,?,?,?,?,?)`,
    [uid, hotelId(req), username.trim(), bcrypt.hashSync(password, 10), role, fullName.trim(), email||'']);
  if (r.ok) audit(hotelId(req), userId(req), 'ADD_USER', 'user', uid, `${role}: ${username.trim()}`);
  res.json(r);
});

app.put('/api/users/:id/toggle', requireRole('admin'), (req, res) => {
  // Prevent admin from disabling themselves
  if (req.params.id === userId(req))
    return res.json({ ok: false, error: 'Cannot disable your own account' });
  const u = q(`SELECT active, hotel_id FROM users WHERE id=?`, [req.params.id])[0];
  if (!u) return res.json({ ok: false, error: 'User not found' });
  if (u.hotel_id !== hotelId(req)) return res.status(403).json({ ok: false, error: 'Forbidden' });

  const newActive = u.active ? 0 : 1;
  const r = run(`UPDATE users SET active=? WHERE id=?`, [newActive, req.params.id]);
  if (r.ok) audit(hotelId(req), userId(req), newActive ? 'ENABLE_USER' : 'DISABLE_USER', 'user', req.params.id);
  res.json(r);
});

app.put('/api/users/:id/password', requireAuth, (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 6)
    return res.json({ ok: false, error: 'Password must be at least 6 characters' });

  // Users can only change their own password unless admin
  const target = q(`SELECT hotel_id FROM users WHERE id=?`, [req.params.id])[0];
  if (!target) return res.json({ ok: false, error: 'User not found' });
  if (target.hotel_id !== hotelId(req)) return res.status(403).json({ ok: false, error: 'Forbidden' });
  if (req.params.id !== userId(req) && req.session.user.role !== 'admin')
    return res.status(403).json({ ok: false, error: 'You can only change your own password' });

  const r = run(`UPDATE users SET password_hash=? WHERE id=?`,
    [bcrypt.hashSync(newPassword, 10), req.params.id]);
  if (r.ok) audit(hotelId(req), userId(req), 'CHANGE_PASSWORD', 'user', req.params.id);
  res.json(r);
});

// ─── DASHBOARD ────────────────────────────────────────────────────────────────
app.get('/api/dashboard', requireAuth, (req, res) => {
  const hid   = hotelId(req);
  const today = new Date().toISOString().slice(0, 10);

  const totalRooms   = q(`SELECT COUNT(*) AS n FROM rooms WHERE hotel_id=?`,                                          [hid])[0]?.n || 0;
  const occupied     = q(`SELECT COUNT(*) AS n FROM rooms WHERE hotel_id=? AND status='occupied'`,                    [hid])[0]?.n || 0;
  const available    = q(`SELECT COUNT(*) AS n FROM rooms WHERE hotel_id=? AND status='available'`,                   [hid])[0]?.n || 0;
  const housekeeping = q(`SELECT COUNT(*) AS n FROM rooms WHERE hotel_id=? AND status='housekeeping'`,                [hid])[0]?.n || 0;
  const todayRev     = q(`SELECT COALESCE(SUM(total),0) AS r FROM bookings WHERE hotel_id=? AND deleted=0 AND DATE(created_at)=?`, [hid, today])[0]?.r || 0;
  const monthRev     = q(`SELECT COALESCE(SUM(total),0) AS r FROM bookings WHERE hotel_id=? AND deleted=0 AND strftime('%Y-%m',created_at)=strftime('%Y-%m','now')`, [hid])[0]?.r || 0;
  const checkinToday = q(`SELECT COUNT(*) AS n FROM bookings WHERE hotel_id=? AND deleted=0 AND DATE(check_in_date)=?`,  [hid, today])[0]?.n || 0;
  const checkoutToday= q(`SELECT COUNT(*) AS n FROM bookings WHERE hotel_id=? AND deleted=0 AND DATE(check_out_date)=?`, [hid, today])[0]?.n || 0;

  const recentBookings = q(`
    SELECT b.booking_ref, g.full_name AS guest_name, r.room_number, b.status, b.total
    FROM bookings b
    JOIN guests g ON b.guest_id = g.id
    JOIN rooms  r ON b.room_id  = r.id
    WHERE b.hotel_id=? AND b.deleted=0
    ORDER BY b.created_at DESC LIMIT 6
  `, [hid]);

  const weeklyOcc = [];
  for (let i = 6; i >= 0; i--) {
    const d  = new Date(); d.setDate(d.getDate() - i);
    const ds = d.toISOString().slice(0, 10);
    const n  = q(`SELECT COUNT(*) AS n FROM bookings WHERE hotel_id=? AND deleted=0 AND DATE(check_in_date)<=? AND DATE(check_out_date)>=?`,
      [hid, ds, ds])[0]?.n || 0;
    weeklyOcc.push({ date: ds, occupied: n, label: d.toLocaleDateString('en', { weekday: 'short' }) });
  }

  res.json({ totalRooms, occupied, available, housekeeping, todayRev, monthRev, checkinToday, checkoutToday, recentBookings, weeklyOcc });
});

// ─── REPORTS ──────────────────────────────────────────────────────────────────
app.get('/api/report', requireRole('manager'), (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) return res.json({ ok: false, error: 'from and to dates required' });

  const bookings = q(`
    SELECT b.*, g.full_name AS guest_name, r.room_number, r.type AS room_type
    FROM bookings b
    JOIN guests g ON b.guest_id = g.id
    JOIN rooms  r ON b.room_id  = r.id
    WHERE b.hotel_id=? AND b.deleted=0 AND b.created_at BETWEEN ? AND ?
    ORDER BY b.created_at DESC
  `, [hotelId(req), from, to + 'T23:59:59']);

  const stats = q(`
    SELECT COUNT(*)    AS total_bookings,
           SUM(total)  AS total_revenue,
           SUM(tax)    AS total_tax,
           AVG(nights) AS avg_nights
    FROM bookings
    WHERE hotel_id=? AND deleted=0 AND created_at BETWEEN ? AND ?
  `, [hotelId(req), from, to + 'T23:59:59'])[0];

  res.json({ bookings, stats });
});

app.get('/api/audit', requireRole('admin'), (req, res) => {
  res.json(q(`
    SELECT a.*, u.full_name AS user_name, u.role
    FROM audit_log a
    LEFT JOIN users u ON a.user_id = u.id
    WHERE a.hotel_id=?
    ORDER BY a.created_at DESC
    LIMIT 300
  `, [hotelId(req)]));
});

// ─── MULTI-HOTEL STATS ────────────────────────────────────────────────────────
app.get('/api/hotel-stats', requireRole('admin'), (req, res) => {
  const hotels = q(`SELECT * FROM hotels ORDER BY name`);
  const today  = new Date().toISOString().slice(0, 10);

  const stats = hotels.map(h => {
    const rooms       = q(`SELECT COUNT(*) AS n FROM rooms WHERE hotel_id=?`,                [h.id])[0]?.n || 0;
    const occupied    = q(`SELECT COUNT(*) AS n FROM rooms WHERE hotel_id=? AND status='occupied'`,   [h.id])[0]?.n || 0;
    const available   = q(`SELECT COUNT(*) AS n FROM rooms WHERE hotel_id=? AND status='available'`,  [h.id])[0]?.n || 0;
    const hkeeping    = q(`SELECT COUNT(*) AS n FROM rooms WHERE hotel_id=? AND status='housekeeping'`,[h.id])[0]?.n || 0;
    const revenue     = q(`SELECT COALESCE(SUM(total),0) AS r FROM bookings WHERE hotel_id=? AND deleted=0`, [h.id])[0]?.r || 0;
    const todayRev    = q(`SELECT COALESCE(SUM(total),0) AS r FROM bookings WHERE hotel_id=? AND deleted=0 AND DATE(created_at)=?`, [h.id, today])[0]?.r || 0;
    const bookings    = q(`SELECT COUNT(*) AS n FROM bookings WHERE hotel_id=? AND deleted=0`, [h.id])[0]?.n || 0;
    const checkedIn   = q(`SELECT COUNT(*) AS n FROM bookings WHERE hotel_id=? AND deleted=0 AND status='checked_in'`, [h.id])[0]?.n || 0;
    const occ = rooms ? Math.round(occupied / rooms * 100) : 0;
    return { ...h, rooms, occupied, available, hkeeping, revenue, todayRev, bookings, checkedIn, occ };
  });
  res.json(stats);
});

// ─── CATCH-ALL → SPA ─────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  const indexPath = path.join(__dirname, 'public', 'index.html');
  res.sendFile(indexPath, err => {
    if (err) {
      console.error('Cannot serve index.html:', err.message);
      console.error('Expected at:', indexPath);
      console.error('__dirname is:', __dirname);
      console.error('public/ contents:', (() => { try { return require('fs').readdirSync(path.join(__dirname,'public')); } catch(e) { return 'folder not found: '+e.message; } })());
      res.status(500).send(`
        <h2>Server Error</h2>
        <p>Cannot find index.html. The public/ directory may be missing from the deployment.</p>
        <p>Expected: ${indexPath}</p>
        <p>Make sure the <code>public/</code> folder is committed to your Git repository.</p>
      `);
    }
  });
});

// ─── START ────────────────────────────────────────────────────────────────────
initDB().then(() => {
  // Verify public/index.html exists before starting
  const indexPath = path.join(__dirname, 'public', 'index.html');
  if (!fs.existsSync(indexPath)) {
    console.error('\n❌ FATAL: public/index.html not found at:', indexPath);
    console.error('   Make sure the public/ folder is committed to your Git repository.');
    console.error('   The public/ folder must NOT be in .gitignore.');
    process.exit(1);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🏨  Grand Vista HMS  —  Web Edition`);
    console.log(`    Running at: http://localhost:${PORT}`);
    console.log(`    Environment: ${NODE_ENV}`);
    console.log(`    public/index.html: ✓ found`);
    console.log(`    Login:  admin / admin123\n`);
  });
}).catch(err => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
