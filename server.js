'use strict';
/* Bienestar estudiantil – servidor
   Solo usa módulos incluidos en Node, salvo "nodemailer" para el correo. */
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');

/* ---------- Configuración (.env) ---------- */
try {
  fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/).forEach(l => {
    if (/^\s*#/.test(l)) return;
    const m = l.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^(["'])(.*)\1$/, '$2');
  });
} catch (e) { /* sin .env */ }

const PORT = +process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const APPROVAL = (process.env.REQUIRE_APPROVAL || 'true').toLowerCase() !== 'false';
const INST = process.env.INSTITUCION || 'Departamento de Bienestar Estudiantil';
const ADMIN_CEDULA = String(process.env.ADMIN_CEDULA || '').replace(/\D/g, '');
const PUB = path.join(__dirname, 'public');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const USE_POSTGRES = !!process.env.DATABASE_URL;
let pool = null;
if (USE_POSTGRES) {
  const { Pool } = require('pg');
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    // Render PostgreSQL accepts TLS; allow its managed certificate chain.
    ssl: (process.env.DATABASE_SSL || 'true').toLowerCase() === 'false' ? false : { rejectUnauthorized: false },
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000
  });
} else {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

/* ---------- Almacenamiento persistente ---------- */
let db = { users: {}, students: {} };
let saveTimer = null;
let writeChain = Promise.resolve();
const today = () => new Date().toISOString().slice(0, 10);
async function initStorage() {
  if (USE_POSTGRES) {
    await pool.query(`CREATE TABLE IF NOT EXISTS bienestar_app_state (
      id SMALLINT PRIMARY KEY CHECK (id = 1),
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    const result = await pool.query('SELECT data FROM bienestar_app_state WHERE id = 1');
    if (result.rowCount) {
      db = result.rows[0].data || { users: {}, students: {} };
    } else {
      // First initialization: import an existing local JSON file if one exists.
      try { db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
      catch (e) { if (e.code !== 'ENOENT') throw e; }
      db.users = db.users || {}; db.students = db.students || {};
      await pool.query('INSERT INTO bienestar_app_state (id, data) VALUES (1, $1::jsonb) ON CONFLICT (id) DO NOTHING', [JSON.stringify(db)]);
      const verify = await pool.query('SELECT data FROM bienestar_app_state WHERE id = 1');
      db = verify.rows[0].data || db;
    }
    db.users = db.users || {}; db.students = db.students || {};
    console.log('Almacenamiento persistente: PostgreSQL.');
  } else {
    try { db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
    catch (e) {
      if (e.code !== 'ENOENT') throw new Error('No se pudo leer ' + DB_FILE + ': ' + e.message + '. No se inicia para evitar pérdida de datos.');
    }
    db.users = db.users || {}; db.students = db.students || {};
    backup();
    console.log('ADVERTENCIA: usando archivo JSON local; no es adecuado para producción en un host efímero.');
  }
}
async function flush() {
  clearTimeout(saveTimer);
  const snapshot = JSON.stringify(db);
  if (USE_POSTGRES) {
    // Serialize writes so an older snapshot cannot overwrite a newer one.
    writeChain = writeChain.then(() => pool.query(
      'INSERT INTO bienestar_app_state (id, data, updated_at) VALUES (1, $1::jsonb, NOW()) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()',
      [snapshot]
    ));
    return writeChain;
  }
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, snapshot);
  fs.renameSync(tmp, DB_FILE);
}
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { flush().catch(e => console.error('Error guardando datos:', e.message)); }, 300);
}
function backup() {
  if (USE_POSTGRES) return; // PostgreSQL is stored separately; file backups are only for local mode.
  try {
    if (!fs.existsSync(DB_FILE)) return;
    const bd = path.join(DATA_DIR, 'backups'); fs.mkdirSync(bd, { recursive: true });
    const f = path.join(bd, 'db-' + today() + '.json');
    fs.copyFileSync(DB_FILE, f);
    const all = fs.readdirSync(bd).filter(x => /^db-\d{4}-\d{2}-\d{2}\.json$/.test(x)).sort();
    all.slice(0, Math.max(0, all.length - 30)).forEach(x => fs.unlinkSync(path.join(bd, x)));
  } catch (e) { console.error('No se pudo respaldar:', e.message); }
}
if (!USE_POSTGRES) setInterval(() => { flush().catch(e => console.error('Error guardando datos:', e.message)); backup(); }, 6 * 3600e3).unref();
async function shutdown() {
  try { await flush(); } catch (e) { console.error('Error al guardar durante el cierre:', e.message); }
  server.close(() => {});
  if (pool) { try { await pool.end(); } catch (e) {} }
  process.exit(0);
}
['SIGINT', 'SIGTERM'].forEach(s => process.on(s, shutdown));

/* ---------- Utilidades ---------- */
const bad = (m, c = 400) => Object.assign(new Error(m), { status: c });
const uid = () => crypto.randomBytes(6).toString('hex');
const reCed = /^\d{9,12}$/, reMail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/, reDate = /^\d{4}-\d{2}-\d{2}$/;
const str = (v, max) => typeof v === 'string' ? v.trim().slice(0, max) : '';
const GN = { 7: 'Sétimo', 8: 'Octavo', 9: 'Noveno', 10: 'Décimo', 11: 'Undécimo', 12: 'Duodécimo' };
const MES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'setiembre', 'octubre', 'noviembre', 'diciembre'];
const fmt = n => '₡' + Number(n).toLocaleString('es-CR', { maximumFractionDigits: 2 });
const totals = s => { let c = 0, p = 0; s.movs.forEach(m => m.tipo === 'cargo' ? c += m.monto : p += m.monto); return { c, p, s: c - p }; };
const json = (res, c, o) => { res.writeHead(c, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(o)); };
const clientIp = req => String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();

/* ---------- Contraseñas y sesiones ---------- */
const hashPw = (pw, salt) => crypto.scryptSync(pw, salt, 64).toString('hex');
function okPw(pw, u) {
  const a = Buffer.from(hashPw(pw, u.salt), 'hex'), b = Buffer.from(u.hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function newUser(id, pw, rol, grado, seccion, aprobado) {
  const salt = crypto.randomBytes(16).toString('hex');
  db.users[id] = { rol, salt, hash: hashPw(pw, salt), grado, seccion, aprobado, creado: today() };
}
const sessions = new Map();
setInterval(() => { const n = Date.now(); sessions.forEach((s, k) => { if (s.exp < n) sessions.delete(k); }); }, 600e3).unref();
const cookies = req => Object.fromEntries((req.headers.cookie || '').split(';').map(s => s.trim().split('=')).filter(a => a[0]).map(a => [a[0], a.slice(1).join('=')]));
function userOf(req) {
  const t = cookies(req).sid, s = t && sessions.get(t);
  if (!s) return null;
  if (s.exp < Date.now()) { sessions.delete(t); return null; }
  const u = db.users[s.id];
  return u && u.aprobado ? { id: s.id, ...u } : null;
}
const pub = u => ({ id: u.id, rol: u.rol, grado: u.grado || 0, seccion: u.seccion || 0 });
function startSession(req, res, id) {
  const t = crypto.randomBytes(24).toString('hex');
  sessions.set(t, { id, exp: Date.now() + 12 * 3600e3 });
  const sec = (req.headers['x-forwarded-proto'] === 'https' || process.env.COOKIE_SECURE === 'true') ? '; Secure' : '';
  res.setHeader('Set-Cookie', `sid=${t}; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200${sec}`);
}
const fails = new Map();
const tooMany = k => { const f = fails.get(k); return f && f.n >= 8 && Date.now() - f.t < 15 * 60e3; };
const failed = k => { const f = fails.get(k); if (!f || Date.now() - f.t > 15 * 60e3) fails.set(k, { n: 1, t: Date.now() }); else { f.n++; f.t = Date.now(); } };

/* ---------- Correo ---------- */
let transporter = null;
(function initMail() {
  const { SMTP_HOST, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) { console.log('Correo automático: NO configurado (revise el archivo .env).'); return; }
  try {
    transporter = require('nodemailer').createTransport({
      host: SMTP_HOST, port: +process.env.SMTP_PORT || 465,
      secure: (process.env.SMTP_SECURE || 'true').toLowerCase() !== 'false',
      auth: { user: SMTP_USER, pass: SMTP_PASS }
    });
    console.log('Correo automático: configurado con ' + SMTP_HOST);
  } catch (e) { console.log('Correo automático: falta instalar nodemailer. Ejecute: npm install'); }
})();
async function sendMail(to, subject, text) {
  if (!transporter) return { sent: false, error: 'El correo automático no está configurado en el servidor.' };
  try {
    await Promise.race([
      transporter.sendMail({ from: process.env.MAIL_FROM || process.env.SMTP_USER, to, subject, text }),
      new Promise((_, no) => setTimeout(() => no(new Error('tiempo de espera agotado')), 20000))
    ]);
    return { sent: true };
  } catch (e) { console.error('Error de correo:', e.message); return { sent: false, error: e.message }; }
}
const recibo = m => m.id.slice(0, 6).toUpperCase();
function receiptText(s, m) {
  const t = totals(s);
  const hist = s.movs.slice(-8).map(x => `  ${x.fecha}  ${x.tipo === 'cargo' ? 'Cargo' : 'Pago '}  ${x.concepto}: ${x.tipo === 'cargo' ? '+' : '-'}${fmt(x.monto)}`).join('\n');
  return `Estimado(a) ${s.encargado}, encargado(a) de ${s.nombre}:\n\nLe confirmamos que recibimos su pago. A continuación el detalle:\n\n` +
    `Recibo n.º: ${recibo(m)}\nFecha del pago: ${m.fecha}\nEstudiante: ${s.nombre}\nCédula: ${s.cedula}\nGrado y sección: ${s.grado}-${s.seccion} (${GN[s.grado]})\n` +
    `Concepto: ${m.concepto}\nMétodo de pago: ${m.metodo || 'No indicado'}\n` + (m.ref ? `Referencia: ${m.ref}\n` : '') +
    `Monto pagado: ${fmt(m.monto)}\n\nResumen de la cuenta:\n  Total a pagar: ${fmt(t.c)}\n  Total abonado a la fecha: ${fmt(t.p)}\n` +
    `  Saldo pendiente: ${t.s > 0.004 ? fmt(t.s) : fmt(0)} (${t.s > 0.004 ? 'pendiente' : 'cuenta al día'})\n\nÚltimos movimientos:\n${hist}\n\n` +
    `Muchas gracias por su colaboración. Si tiene alguna consulta, con gusto le atendemos.\n\n${INST}`;
}
function statementText(s) {
  const t = totals(s), ms = s.movs.slice().sort((a, b) => a.fecha.localeCompare(b.fecha));
  let run = 0; const pm = {};
  const filas = ms.map(m => { run += m.tipo === 'cargo' ? m.monto : -m.monto; if (m.tipo === 'pago') pm[m.fecha.slice(0, 7)] = (pm[m.fecha.slice(0, 7)] || 0) + m.monto; return `  ${m.fecha}  ${m.concepto}: ${m.tipo === 'cargo' ? '+' : '-'}${fmt(m.monto)}  (saldo ${fmt(run)})`; });
  const meses = Object.keys(pm).sort().map(k => { const p = k.split('-'); return `  ${MES[+p[1] - 1]} ${p[0]}: ${fmt(pm[k])}`; });
  return `Estimado(a) ${s.encargado}:\n\nLe compartimos el estado de cuenta de ${s.nombre} (${s.grado}-${s.seccion}) al ${today()}:\n\n` +
    `  Total a pagar: ${fmt(t.c)}\n  Total abonado: ${fmt(t.p)}\n  Saldo pendiente: ${fmt(Math.max(t.s, 0))}\n  Estado: ${t.c === 0 ? 'Sin cargos' : t.s > 0.004 ? 'Pendiente' : 'Al día'}\n\n` +
    `Abonos por mes:\n${meses.join('\n') || '  Sin abonos registrados'}\n\nMovimientos:\n${filas.join('\n') || '  Sin movimientos'}\n\n${INST}`;
}
async function sendReceipt(s, m) {
  const r = await sendMail(s.correo, `Confirmación de pago – ${s.nombre} (${s.grado}-${s.seccion})`, receiptText(s, m));
  return { recibo: recibo(m), to: s.correo, ...r };
}

/* ---------- Estudiantes ---------- */
const inScope = (u, s) => u.rol === 'admin' || (s.grado === u.grado && s.seccion === u.seccion);
function cleanStudent(b) {
  const s = {
    nombre: str(b.nombre, 120), cedula: String(b.cedula == null ? '' : b.cedula).replace(/\D/g, ''), encargado: str(b.encargado, 120),
    correo: str(b.correo, 120).toLowerCase(), telefono: str(b.telefono, 30), grado: +b.grado, seccion: +b.seccion, movs: []
  };
  if (!s.nombre) throw bad('Falta el nombre del estudiante.');
  if (!reCed.test(s.cedula)) throw bad('La cédula del estudiante debe tener de 9 a 12 dígitos.');
  if (!s.encargado) throw bad('Falta el nombre del encargado.');
  if (!reMail.test(s.correo)) throw bad('El correo del encargado no es válido.');
  if (!(s.grado >= 7 && s.grado <= 12 && s.seccion >= 1 && s.seccion <= 4)) throw bad('Grado o sección no válidos.');
  if (!Array.isArray(b.movs) || b.movs.length > 600) throw bad('Movimientos no válidos.');
  const ids = new Set();
  for (const m of b.movs) {
    if (!m || (m.tipo !== 'cargo' && m.tipo !== 'pago')) throw bad('Movimiento no válido.');
    const id = str(m.id, 40); if (!id || ids.has(id)) throw bad('Movimiento repetido o sin identificador.'); ids.add(id);
    const monto = Number(m.monto); if (!(monto > 0) || !isFinite(monto) || monto > 1e9) throw bad('Monto no válido.');
    const fecha = str(m.fecha, 10); if (!reDate.test(fecha)) throw bad('Fecha no válida.');
    const o = { id, tipo: m.tipo, concepto: str(m.concepto, 120) || (m.tipo === 'pago' ? 'Abono' : 'Cargo'), monto: Math.round(monto * 100) / 100, fecha };
    if (m.tipo === 'pago') { o.metodo = str(m.metodo, 40); o.ref = str(m.ref, 60); }
    s.movs.push(o);
  }
  return s;
}
async function putStudent(u, id, body) {
  if (!/^[A-Za-z0-9]{4,40}$/.test(id)) throw bad('Identificador no válido.');
  const n = cleanStudent(body), old = db.students[id];
  if (old && !inScope(u, old)) throw bad('No tiene permiso sobre este estudiante.', 403);
  if (!inScope(u, n)) throw bad('Solo puede trabajar con su propia sección.', 403);
  for (const k in db.students) if (k !== id && db.students[k].cedula === n.cedula) throw bad('Ya existe un estudiante con esa cédula.', 409);
  if (old && u.rol !== 'admin') {
    const nm = new Map(n.movs.map(m => [m.id, JSON.stringify(m)]));
    if (old.movs.some(m => nm.get(m.id) !== JSON.stringify(m))) throw bad('Solo un administrador puede modificar o eliminar movimientos.', 403);
  }
  const prev = new Set((old ? old.movs : []).map(m => m.id));
  const nuevos = n.movs.filter(m => m.tipo === 'pago' && !prev.has(m.id));
  db.students[id] = { ...n, creado: old ? old.creado : today() };
  persist();
  const emails = [];
  for (const m of nuevos) emails.push(await sendReceipt(db.students[id], m));
  return { ok: true, emails };
}
function studentFor(u, id) {
  const s = db.students[id];
  if (!s) throw bad('Estudiante no encontrado.', 404);
  if (!inScope(u, s)) throw bad('No tiene permiso sobre este estudiante.', 403);
  return s;
}

/* ---------- API ---------- */
function readBody(req) {
  return new Promise((ok, no) => {
    let d = '', n = 0;
    req.on('data', c => { n += c.length; if (n > 2e6) { no(bad('Solicitud demasiado grande.', 413)); req.destroy(); return; } d += c; });
    req.on('end', () => { if (!d) return ok({}); try { ok(JSON.parse(d)); } catch (e) { no(bad('Datos no válidos.')); } });
    req.on('error', no);
  });
}
const validUserFields = (b, rol) => {
  const ced = String(b.cedula || '').replace(/\D/g, ''), pw = String(b.password || '');
  if (!reCed.test(ced)) throw bad('La cédula debe tener de 9 a 12 dígitos.');
  if (pw.length < 6 || pw.length > 100) throw bad('La contraseña debe tener al menos 6 caracteres.');
  if (db.users[ced]) throw bad('Ya existe una cuenta con esa cédula.', 409);
  let grado = 0, seccion = 0;
  if (rol === 'profe') {
    grado = +b.grado; seccion = +b.seccion;
    if (!(grado >= 7 && grado <= 12 && seccion >= 1 && seccion <= 4)) throw bad('Elija un grado y una sección válidos.');
  }
  return { ced, pw, grado, seccion };
};
const hayAdmin = () => Object.values(db.users).some(u => u.rol === 'admin');

async function api(req, res, p) {
  const m = req.method;
  if (m !== 'GET') {
    const o = req.headers.origin;
    if (o) { let h; try { h = new URL(o).host; } catch (e) { } if (h !== req.headers.host) throw bad('Origen no permitido.', 403); }
  }
  if (p === '/api/health') return json(res, 200, { ok: true });
  if (p === '/api/config') return json(res, 200, { correoAutomatico: !!transporter, aprobacion: APPROVAL, hayAdmin: hayAdmin() });
  const b = (m === 'GET' || m === 'DELETE') ? {} : await readBody(req);

  if (p === '/api/register' && m === 'POST') {
    const rol = b.rol === 'admin' ? 'admin' : 'profe';
    if (rol === 'admin') {
      if (hayAdmin()) throw bad('Ya existe un administrador. Pídale que cree su cuenta desde “Usuarios”.', 403);
      if (ADMIN_CEDULA && String(b.cedula || '').replace(/\D/g, '') !== ADMIN_CEDULA) throw bad('Esa cédula no está autorizada para crear la cuenta de administrador.', 403);
    }
    const f = validUserFields(b, rol), aprobado = rol === 'admin' || !APPROVAL;
    newUser(f.ced, f.pw, rol, f.grado, f.seccion, aprobado); persist();
    if (!aprobado) return json(res, 201, { ok: true, pendiente: true });
    startSession(req, res, f.ced);
    return json(res, 200, { ok: true, user: pub({ id: f.ced, ...db.users[f.ced] }) });
  }
  if (p === '/api/login' && m === 'POST') {
    const ced = String(b.cedula || '').replace(/\D/g, ''), pw = String(b.password || ''), k = clientIp(req) + ':' + ced;
    if (tooMany(k)) throw bad('Demasiados intentos. Espere 15 minutos e intente de nuevo.', 429);
    const u = db.users[ced];
    if (!u || !okPw(pw, u)) { failed(k); throw bad('Cédula o contraseña incorrecta.', 401); }
    if (b.rol && u.rol !== b.rol) throw bad('Esa cuenta es de ' + (u.rol === 'admin' ? 'administrador' : 'profe guía') + '. Cambie la opción de arriba.', 403);
    if (!u.aprobado) throw bad('Su cuenta todavía no ha sido aprobada por un administrador.', 403);
    fails.delete(k); startSession(req, res, ced);
    return json(res, 200, { user: pub({ id: ced, ...u }) });
  }
  if (p === '/api/logout' && m === 'POST') {
    const t = cookies(req).sid; if (t) sessions.delete(t);
    res.setHeader('Set-Cookie', 'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
    return json(res, 200, { ok: true });
  }

  const u = userOf(req);
  if (!u) throw bad('Inicie sesión para continuar.', 401);
  if (p === '/api/me' && m === 'GET') return json(res, 200, { user: pub(u), correoAutomatico: !!transporter });

  let r;
  if ((r = p.match(/^\/api\/students(?:\/([A-Za-z0-9]+))?(?:\/(receipt|statement))?$/))) {
    const id = r[1], sub = r[2];
    if (!id && m === 'GET') {
      const list = Object.entries(db.students).filter(([, s]) => inScope(u, s)).map(([k, s]) => ({ id: k, ...s }));
      return json(res, 200, { students: list });
    }
    if (id && !sub && m === 'PUT') return json(res, 200, await putStudent(u, id, b));
    if (id && !sub && m === 'DELETE') {
      if (u.rol !== 'admin') throw bad('Solo un administrador puede eliminar estudiantes.', 403);
      delete db.students[id]; persist(); return json(res, 200, { ok: true });
    }
    if (id && sub === 'receipt' && m === 'POST') {
      const s = studentFor(u, id), mv = s.movs.find(x => x.id === b.movId && x.tipo === 'pago');
      if (!mv) throw bad('Pago no encontrado.', 404);
      return json(res, 200, await sendReceipt(s, mv));
    }
    if (id && sub === 'statement' && m === 'POST') {
      const s = studentFor(u, id);
      return json(res, 200, { to: s.correo, ...(await sendMail(s.correo, `Estado de cuenta – ${s.nombre} (${s.grado}-${s.seccion})`, statementText(s))) });
    }
  }

  if (u.rol !== 'admin') throw bad('Solo un administrador puede hacer esto.', 403);

  if (p === '/api/reset' && m === 'POST') {
    if (b.confirm !== 'BORRAR') throw bad('Falta la confirmación.');
    if (b.mode === 'all') db.students = {};
    else if (b.mode === 'movs') Object.values(db.students).forEach(s => { s.movs = []; });
    else throw bad('Opción no válida.');
    persist(); return json(res, 200, { ok: true });
  }
  if ((r = p.match(/^\/api\/users(?:\/(\d+))?$/))) {
    const id = r[1];
    if (!id && m === 'GET') {
      const list = Object.entries(db.users).map(([k, x]) => ({ id: k, rol: x.rol, grado: x.grado, seccion: x.seccion, aprobado: !!x.aprobado, creado: x.creado }));
      return json(res, 200, { users: list.sort((a, c) => (a.aprobado - c.aprobado) || a.id.localeCompare(c.id)) });
    }
    if (!id && m === 'POST') {
      const rol = b.rol === 'admin' ? 'admin' : 'profe', f = validUserFields(b, rol);
      newUser(f.ced, f.pw, rol, f.grado, f.seccion, true); persist(); return json(res, 200, { ok: true });
    }
    if (id && m === 'PATCH') {
      const x = db.users[id]; if (!x) throw bad('Usuario no encontrado.', 404);
      if (typeof b.aprobado === 'boolean') { if (id === u.id && !b.aprobado) throw bad('No puede desactivar su propia cuenta.'); x.aprobado = b.aprobado; }
      if (b.password != null) {
        const pw = String(b.password); if (pw.length < 6 || pw.length > 100) throw bad('La contraseña debe tener al menos 6 caracteres.');
        x.salt = crypto.randomBytes(16).toString('hex'); x.hash = hashPw(pw, x.salt);
        sessions.forEach((s, k) => { if (s.id === id) sessions.delete(k); });
      }
      persist(); return json(res, 200, { ok: true });
    }
    if (id && m === 'DELETE') {
      if (id === u.id) throw bad('No puede eliminar su propia cuenta.');
      const x = db.users[id]; if (!x) throw bad('Usuario no encontrado.', 404);
      if (x.rol === 'admin' && Object.values(db.users).filter(y => y.rol === 'admin').length < 2) throw bad('Debe quedar al menos un administrador.');
      delete db.users[id]; sessions.forEach((s, k) => { if (s.id === id) sessions.delete(k); });
      persist(); return json(res, 200, { ok: true });
    }
  }
  throw bad('No encontrado.', 404);
}

/* ---------- Archivos estáticos y servidor ---------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.ico': 'image/x-icon' };
function serveStatic(res, p) {
  let f; try { f = decodeURIComponent(p); } catch (e) { f = '/'; }
  if (f === '/') f = '/index.html';
  const full = path.normalize(path.join(PUB, f));
  if (!full.startsWith(PUB + path.sep)) { res.writeHead(404); return res.end(); }
  fs.readFile(full, (e, d) => {
    if (e) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('No encontrado'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream', 'Cache-Control': f === '/index.html' || f === '/sw.js' ? 'no-cache' : 'public, max-age=3600' });
    res.end(d);
  });
}
const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'");
  try {
    const p = new URL(req.url, 'http://x').pathname;
    if (p.startsWith('/api/')) return await api(req, res, p);
    if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(res, p);
    res.writeHead(405); res.end();
  } catch (e) {
    if (e.status) return json(res, e.status, { error: e.message });
    console.error(e); json(res, 500, { error: 'Error interno del servidor.' });
  }
});
initStorage().then(() => {
  server.listen(PORT, process.env.HOST || '0.0.0.0', () => {
    console.log(`Bienestar estudiantil listo en http://localhost:${PORT}`);
    if (!hayAdmin()) console.log('Aún no hay administrador: abra la página y cree la primera cuenta (opción “Administrador”).');
  });
}).catch(async e => {
  console.error('No se pudo inicializar el almacenamiento. El servidor no se inicia para evitar pérdida de datos:', e.message);
  if (pool) { try { await pool.end(); } catch (_) {} }
  process.exit(1);
});
