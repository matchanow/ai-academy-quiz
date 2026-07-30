const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_DIR = path.join(__dirname, 'db');
const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Simple JSON file database ─────────────────────────────────────

if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR);
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// ─── Multer setup ───────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `q-${Date.now()}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Faqat rasm fayllari qabul qilinadi'));
  }
});

// ─── Audio upload (diktant materiali + o'quvchi yozuvlari) ──────────
const AUDIO_DIR = path.join(UPLOADS_DIR, 'audio');
if (!fs.existsSync(AUDIO_DIR)) fs.mkdirSync(AUDIO_DIR, { recursive: true });

const audioUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, AUDIO_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || '.webm';
      cb(null, `a-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
    }
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    // MediaRecorder ba'zi brauzerlarda audio-only oqimni video/webm deb belgilaydi
    if (file.mimetype.startsWith('audio/') || file.mimetype === 'video/webm') cb(null, true);
    else cb(new Error('Faqat audio fayllar qabul qilinadi'));
  }
});

function loadTable(name) {
  const file = path.join(DB_DIR, name + '.json');
  if (!fs.existsSync(file)) return [];
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return []; }
}

function saveTable(name, data) {
  fs.writeFileSync(path.join(DB_DIR, name + '.json'), JSON.stringify(data, null, 2));
}

function nextId(table) {
  if (!table.length) return 1;
  return Math.max(...table.map(r => r.id)) + 1;
}

function insert(name, record) {
  const table = loadTable(name);
  const newRecord = { id: nextId(table), ...record, created_at: new Date().toISOString() };
  table.push(newRecord);
  saveTable(name, table);
  return newRecord;
}

function findAll(name, pred) {
  const t = loadTable(name);
  return pred ? t.filter(pred) : t;
}

function findOne(name, pred) {
  return loadTable(name).find(pred) || null;
}

function updateOne(name, pred, updates) {
  const t = loadTable(name).map(r => pred(r) ? { ...r, ...updates } : r);
  saveTable(name, t);
}

function deleteOne(name, pred) {
  saveTable(name, loadTable(name).filter(r => !pred(r)));
}

function getImageUrls(q) {
  if (Array.isArray(q.image_urls)) return q.image_urls;
  if (q.image_url) return [q.image_url];
  return [];
}

/** Savolda mavjud variant kalitlari. option_e ixtiyoriy — bo'lsa 5 variantli savol. */
function optionKeys(q) {
  const keys = ['a', 'b', 'c', 'd'];
  if (q.option_e && String(q.option_e).trim()) keys.push('e');
  return keys;
}

/** Savol maydonlarini tekshiradi. Xato bo'lsa matn, aks holda null qaytaradi. */
function validateQuestion(body) {
  if (!body.question_text || !String(body.question_text).trim()) return "Savol matni bo'sh";
  if (!body.option_a || !body.option_b || !body.option_c || !body.option_d) {
    return "A–D variantlari to'ldirilishi shart";
  }
  if (!optionKeys(body).includes(body.correct_answer)) {
    return "To'g'ri javob mavjud variantlardan biri bo'lishi kerak";
  }
  return null;
}

// ─── Diktantni baholash ─────────────────────────────────────────────

/** Solishtirish uchun matnni normallashtiradi: kichik harf, tinish belgilarisiz,
 *  o'zbek apostroflarining barcha ko'rinishi bitta belgiga keltiriladi. */
function normalizeText(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .replace(/[‘’ʻʼ`´]/g, "'")
    .replace(/[^\p{L}\p{N}'\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** So'zlar ustidagi Levenshtein masofasi — WER hisoblash uchun. */
function wordDistance(ref, hyp) {
  const n = ref.length, m = hyp.length;
  if (!n) return m;
  if (!m) return n;
  let prev = Array.from({ length: m + 1 }, (_, j) => j);
  for (let i = 1; i <= n; i++) {
    const cur = [i];
    for (let j = 1; j <= m; j++) {
      cur[j] = ref[i - 1] === hyp[j - 1]
        ? prev[j - 1]
        : 1 + Math.min(prev[j - 1], prev[j], cur[j - 1]);
    }
    prev = cur;
  }
  return prev[m];
}

/** Diktant javobini baholaydi: aniqlik (%), WER (%) va terish tezligi (WPM). */
function gradeDictation(reference, typed, elapsedMs) {
  const refWords = normalizeText(reference).split(' ').filter(Boolean);
  const hypWords = normalizeText(typed).split(' ').filter(Boolean);

  const dist = wordDistance(refWords, hypWords);
  const wer = refWords.length ? dist / refWords.length : (hypWords.length ? 1 : 0);

  // WPM standarti: 5 belgi = 1 "so'z"
  const minutes = Math.max(elapsedMs, 1) / 60000;
  const typedChars = String(typed == null ? '' : typed).length;

  return {
    accuracy: Math.max(0, Math.round((1 - wer) * 100)),
    wer: Math.round(wer * 1000) / 10,
    wpm: Math.round((typedChars / 5) / minutes),
    ref_words: refWords.length,
    typed_words: hypWords.length,
    typed_chars: typedChars
  };
}

// ─── Seed data ──────────────────────────────────────────────────────

if (!findOne('users', u => u.phone === '949303047')) {
  insert('users', { name: 'Admin', phone: '949303047', is_admin: true });
}

const testUser = findOne('users', u => u.phone === '949303046');
if (!testUser) {
  insert('users', { name: 'Test', phone: '949303046', is_admin: false, can_retake: true });
} else if (!testUser.can_retake) {
  updateOne('users', u => u.phone === '949303046', { can_retake: true });
}

if (!findAll('questions').length) {
  const qs = [
    { question_text: "2 + 2 × 2 ifodaning natijasi qancha?",
      option_a: "8", option_b: "6", option_c: "4", option_d: "16", correct_answer: "b", order_num: 1 },
    { question_text: "Artificial Intelligence (AI) o'zbek tiliga qanday tarjima qilinadi?",
      option_a: "Tabiiy intellekt", option_b: "Raqamli texnologiya", option_c: "Sun'iy intellekt", option_d: "Kompyuter fani", correct_answer: "c", order_num: 2 },
    { question_text: "Python dasturlash tilida ro'yxat (list) yaratish uchun qaysi belgilar ishlatiladi?",
      option_a: "{ }", option_b: "( )", option_c: "< >", option_d: "[ ]", correct_answer: "d", order_num: 3 },
    { question_text: "Qaysi sanoq tizimi faqat 0 va 1 raqamlaridan iborat?",
      option_a: "O'nlik (Decimal)", option_b: "Sakkizlik (Octal)", option_c: "Ikkilik (Binary)", option_d: "O'n oltilik (Hexadecimal)", correct_answer: "c", order_num: 4 },
    { question_text: "Internet tarmog'ida xavfsiz veb-sahifalar qaysi protokol orqali uzatiladi?",
      option_a: "FTP", option_b: "SMTP", option_c: "HTTP", option_d: "HTTPS", correct_answer: "d", order_num: 5 },
    { question_text: "Machine Learning (ML) deganda nima tushuniladi?",
      option_a: "Mashinalarni ta'mirlash", option_b: "Kompyuterga ma'lumot o'qitish", option_c: "Robot yasash", option_d: "Internet tarmog'ini kengaytirish", correct_answer: "b", order_num: 6 },
    { question_text: "Python'da x = 10 bo'lsa, x // 3 ning qiymati qancha?",
      option_a: "3.33", option_b: "3", option_c: "4", option_d: "0", correct_answer: "b", order_num: 7 },
    { question_text: "Deep Learning qaysi texnologiyaga asoslanadi?",
      option_a: "Ekspert tizimlar", option_b: "Genetik algoritmlar", option_c: "Sun'iy neyron tarmoqlar", option_d: "Qidiruv algoritmlari", correct_answer: "c", order_num: 8 },
    { question_text: "RAM (Random Access Memory) nima uchun ishlatiladi?",
      option_a: "Doimiy ma'lumot saqlash", option_b: "Vaqtincha ma'lumot saqlash", option_c: "Internet ulanishni ta'minlash", option_d: "Grafik ma'lumotlarni qayta ishlash", correct_answer: "b", order_num: 9 },
    { question_text: "Quyidagi algoritmlardan qaysi biri saralash (sorting) algoritmi?",
      option_a: "Binary Search", option_b: "Bubble Sort", option_c: "BFS (Kenglik bo'yicha qidiruv)", option_d: "Dijkstra algoritmi", correct_answer: "b", order_num: 10 }
  ];
  qs.forEach(q => insert('questions', q));
}

if (!findAll('tasks').length) {
  const seedTasks = [
    { type: 'dictation', sort_order: 1, title: 'Diktant 1 — Sun\'iy intellekt',
      text: "Sun'iy intellekt inson aqli bajaradigan vazifalarni kompyuter yordamida hal qilish texnologiyasidir." },
    { type: 'dictation', sort_order: 2, title: 'Diktant 2 — Mashina o\'qitish',
      text: "Mashina o'qitish algoritmlari katta hajmdagi ma'lumotlardan qonuniyatlarni topib, kelgusi natijalarni bashorat qiladi." },
    { type: 'dictation', sort_order: 3, title: 'Diktant 3 — Nutq texnologiyalari',
      text: "Nutqni matnga aylantiruvchi tizimlar ovozli buyruqlarni tushunadi va ularni yozma ko'rinishga o'tkazadi." },
    { type: 'reading', sort_order: 4, title: 'O\'qish 1 — Neyron tarmoqlar',
      text: "Sun'iy neyron tarmoqlar inson miyasidagi neyronlar ishlash tamoyiliga taqlid qiladi. Har bir bog'lanish o'zining og'irligiga ega bo'lib, tarmoq o'qitilganda aynan shu og'irliklar o'zgaradi." },
    { type: 'reading', sort_order: 5, title: 'O\'qish 2 — Ma\'lumotlar xavfsizligi',
      text: "Internetda shaxsiy ma'lumotlarni himoya qilish uchun kuchli parol qo'yish, ikki bosqichli tasdiqlashni yoqish va noma'lum havolalarni ochmaslik tavsiya etiladi." }
  ];
  seedTasks.forEach(t => insert('tasks', { audio_url: null, ...t }));
}

// ─── Routes ────────────────────────────────────────────────────────

/** Butun testga beriladigan vaqt. */
const TEST_DURATION_MS = 15 * 60 * 1000;

const RESTRICT_MSG = "Kirish taqiqlangan. Test davomida boshqa oyna yoki ilovaga o'tilgani " +
                     "aniqlandi. Qayta urinish uchun o'qituvchiga murojaat qiling.";

/** Mijozga yuboriladigan foydalanuvchi maydonlari. */
function publicUser(u) {
  return { id: u.id, name: u.name, phone: u.phone, is_admin: !!u.is_admin };
}

/* Kirill harflarini lotinga o'girish jadvali — bir xil ismni
   "Xaydarov" va "Хайдаров" ko'rinishida yozib o'tib ketmasin. */
const CYR_LAT = {
  'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'yo','ж':'j','з':'z',
  'и':'i','й':'y','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r',
  'с':'s','т':'t','у':'u','ф':'f','х':'x','ц':'ts','ч':'ch','ш':'sh',
  'щ':'sh','ъ':'','ы':'i','ь':'','э':'e','ю':'yu','я':'ya',
  'ў':'o','қ':'q','ғ':'g','ҳ':'h'
};

/** Ism-familiyani solishtirish uchun kalit.
 *  - kichik harf, apostrof va tinish belgilari tushadi
 *  - kirill lotinga o'giriladi
 *  - x va h bitta harfga keltiriladi (Xaydarov / Haydarov)
 *  - so'zlar alifbo tartibida saralanadi
 *  Shu tufayli "Suxrob Xaydarov" va "Xaydarov Suxrob" — bitta kalit. */
function nameKey(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[Ѐ-ӿ]/g, c => (c in CYR_LAT ? CYR_LAT[c] : c))
    .replace(/[‘’ʻʼ`´']/g, '')
    .replace(/x/g, 'h')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/).filter(Boolean)
    .sort()
    .join(' ');
}

/** Bloklangan odamni topadi: telefon, pasport yoki ism-familiya bo'yicha.
 *  Ism bo'yicha bloklash bir xil ismli begunoh o'quvchini ham ushlab
 *  qolishi mumkin — shuning uchun admin panelda blokni ochish bor. */
function findRestricted({ phone, passport_id, name }) {
  const key = name ? nameKey(name) : '';
  return findOne('users', u => u.restricted && (
    (phone && u.phone === phone) ||
    (passport_id && u.passport_id && u.passport_id === passport_id) ||
    (key && nameKey(u.name) === key)
  ));
}

app.post('/api/auth', (req, res) => {
  const { phone, name, address, passport_id, parent_phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'Telefon raqam kiritilishi shart' });
  const cleanPhone = phone.trim().replace(/\D/g, '');
  if (cleanPhone.length !== 9) return res.status(400).json({ error: 'Telefon raqam aynan 9 ta raqamdan iborat bo\'lishi kerak' });

  const user = findOne('users', u => u.phone === cleanPhone);

  // Bu odam bloklanganmi? Faqat o'z raqami emas — xuddi shu pasport yoki
  // ism-familiya bilan bloklangan hisob bo'lsa ham kiritmaymiz.
  if (!(user && user.is_admin) && findRestricted({
    phone: cleanPhone,
    passport_id: user && user.passport_id,
    name: user && user.name
  })) {
    return res.status(403).json({ restricted: true, error: RESTRICT_MSG });
  }

  if (user) {
    if (user.is_admin) {
      return res.json({ success: true, user: publicUser(user) });
    }
    if (user.can_retake) {
      return res.json({ success: true, user: publicUser(user), quiz_completed: false });
    }
    const attempt = findOne('attempts', a => a.user_id === user.id && a.completed_at);
    const total = findAll('questions').length;
    return res.json({
      success: true,
      user: publicUser(user),
      quiz_completed: !!attempt,
      score: attempt ? attempt.score : null,
      total
    });
  }

  if (!name || !name.trim()) return res.json({ success: false, needs_registration: true });

  // Ro'yxatdan o'tish maydonlari — hammasi majburiy
  const cleanAddress  = String(address || '').trim();
  const cleanPassport = String(passport_id || '').trim().toUpperCase();
  const cleanParent   = String(parent_phone || '').replace(/\D/g, '');

  if (!cleanAddress) return res.status(400).json({ error: 'Yashash joyi kiritilishi shart' });
  if (!/^[A-Z]{2}\d{7}$/.test(cleanPassport)) {
    return res.status(400).json({ error: "Pasport / ID raqami AA1234567 ko'rinishida bo'lishi kerak" });
  }
  if (cleanParent.length !== 9) {
    return res.status(400).json({ error: "Ota yoki ona raqami aynan 9 ta raqamdan iborat bo'lishi kerak" });
  }
  // O'z raqamini ota-ona raqami sifatida yozib qo'ymasin — aks holda bu maydon foydasiz
  if (cleanParent === cleanPhone) {
    return res.status(400).json({ error: "Ota yoki ona raqami o'quvchining raqamidan farq qilishi kerak" });
  }

  // Bloklangan odam yangi raqam bilan qaytib kelmasin — pasport va
  // ism-familiya bo'yicha tekshiramiz (so'z tartibi ahamiyatsiz)
  if (findRestricted({ passport_id: cleanPassport, name })) {
    return res.status(403).json({ restricted: true, error: RESTRICT_MSG });
  }

  const duplicate = findOne('users', u => u.phone === cleanPhone);
  if (duplicate) return res.status(409).json({ error: "Bu telefon raqam allaqachon ro'yxatdan o'tgan" });

  // Bir kishi bir necha raqam bilan qayta ro'yxatdan o'tmasligi uchun
  if (findOne('users', u => u.passport_id === cleanPassport)) {
    return res.status(409).json({ error: "Bu pasport / ID raqami allaqachon ro'yxatdan o'tgan" });
  }

  const newUser = insert('users', {
    name: name.trim(),
    phone: cleanPhone,
    address: cleanAddress,
    passport_id: cleanPassport,
    parent_phone: cleanParent,
    is_admin: false
  });
  res.json({
    success: true,
    user: publicUser(newUser),
    quiz_completed: false
  });
});

// ─── Image upload ───────────────────────────────────────────────────
app.post('/api/admin/upload', upload.single('image'), (req, res) => {
  if (!requireAdmin(req.body.admin_id)) return res.status(403).json({ error: "Ruxsat yo'q" });
  if (!req.file) return res.status(400).json({ error: 'Fayl yuklanmadi' });
  res.json({ success: true, url: `/uploads/${req.file.filename}` });
});

app.delete('/api/admin/upload', (req, res) => {
  if (!requireAdmin(req.body.admin_id)) return res.status(403).json({ error: "Ruxsat yo'q" });
  const { filename } = req.body;
  if (filename) {
    const fp = path.join(UPLOADS_DIR, path.basename(filename));
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  }
  res.json({ success: true });
});

app.get('/api/questions', (req, res) => {
  const qs = findAll('questions').sort((a, b) => a.order_num - b.order_num)
    .map(q => ({ id: q.id, question_text: q.question_text, option_a: q.option_a, option_b: q.option_b,
      option_c: q.option_c, option_d: q.option_d, option_e: q.option_e || null, order_num: q.order_num,
      option_images: q.option_images || null,
      time_seconds: q.time_seconds || 30, image_urls: getImageUrls(q) }));
  res.json(qs);
});

/* ─── Test sessiyasi ────────────────────────────────────────────────
   Butun testga 15 daqiqa. Muddat serverda saqlanadi, shuning uchun
   sahifani qayta yuklash yoki localStorage'ni tozalash vaqtni
   tiklamaydi. */
app.post('/api/quiz/start', (req, res) => {
  const user = findOne('users', u => u.id === parseInt(req.body.user_id));
  if (!user || user.is_admin) return res.status(403).json({ error: "Ruxsat yo'q" });
  if (user.restricted) return res.status(403).json({ restricted: true, error: RESTRICT_MSG });

  let s = findOne('sessions', x => x.user_id === user.id);

  // Qayta topshirishga ruxsat berilgan hisob (test akkaunti) — muddati
  // tugagan sessiyani tashlab, yangisini ochamiz. Test davomida qayta
  // yuklash vaqtni tiklamaydi, chunki bu faqat muddat tugagach ishlaydi.
  if (s && user.can_retake && new Date(s.deadline).getTime() <= Date.now()) {
    deleteOne('sessions', x => x.user_id === user.id);
    s = null;
  }

  if (!s) {
    s = insert('sessions', {
      user_id: user.id,
      started_at: new Date().toISOString(),
      deadline: new Date(Date.now() + TEST_DURATION_MS).toISOString()
    });
  }

  const remaining = new Date(s.deadline).getTime() - Date.now();
  res.json({
    success: true,
    duration_ms: TEST_DURATION_MS,
    remaining_ms: Math.max(0, remaining),
    expired: remaining <= 0
  });
});

/* ─── Qoidabuzarlik ─────────────────────────────────────────────────
   Test davomida boshqa oynaga o'tilgani aniqlanganda chaqiriladi.
   Foydalanuvchi bloklanadi: telefon va pasport raqami bo'yicha
   qaytib kira olmaydi. Admin panelda blokni ochish mumkin. */
app.post('/api/quiz/violation', (req, res) => {
  const user = findOne('users', u => u.id === parseInt(req.body.user_id));
  if (!user || user.is_admin) return res.status(403).json({ error: "Ruxsat yo'q" });

  if (!user.restricted) {
    updateOne('users', u => u.id === user.id, {
      restricted: true,
      restricted_at: new Date().toISOString(),
      restrict_reason: String(req.body.reason || 'boshqa oynaga o\'tildi').slice(0, 120)
    });
  }
  res.json({ success: true, restricted: true, message: RESTRICT_MSG });
});

app.post('/api/quiz/submit', (req, res) => {
  const { user_id, answers } = req.body;
  if (!user_id || !Array.isArray(answers)) return res.status(400).json({ error: "Noto'g'ri ma'lumot" });

  const user = findOne('users', u => u.id === user_id);
  if (!user || user.is_admin) return res.status(403).json({ error: "Ruxsat yo'q" });

  const existingAttempt = findOne('attempts', a => a.user_id === user_id && a.completed_at);
  if (existingAttempt) {
    if (!user.can_retake) return res.status(409).json({ error: 'Test allaqachon topshirilgan' });
    deleteOne('attempts', a => a.id === existingAttempt.id);
    saveTable('answers', loadTable('answers').filter(a => a.attempt_id !== existingAttempt.id));
  }

  const questions = findAll('questions');
  const qMap = Object.fromEntries(questions.map(q => [q.id, q]));

  let score = 0;
  const graded = answers.map(a => {
    const q = qMap[a.question_id];
    const correct = q && a.selected_answer === q.correct_answer ? 1 : 0;
    if (correct) score++;
    return { question_id: a.question_id, selected_answer: a.selected_answer || null, is_correct: correct };
  });

  const attempt = insert('attempts', { user_id, completed_at: new Date().toISOString(), score });
  graded.forEach(a => insert('answers', { attempt_id: attempt.id, ...a }));

  res.json({ success: true, score, total: questions.length });
});

app.get('/api/results/:userId', (req, res) => {
  const userId = parseInt(req.params.userId);
  const attempt = findOne('attempts', a => a.user_id === userId && a.completed_at);
  if (!attempt) return res.status(404).json({ error: "Natija yo'q" });

  const questions = findAll('questions');
  const qMap = Object.fromEntries(questions.map(q => [q.id, q]));
  const answers = findAll('answers', a => a.attempt_id === attempt.id)
    .filter(a => qMap[a.question_id])   // o'chirilgan savolga tegishli javoblar tushib qoladi
    .map(a => ({ ...a, ...qMap[a.question_id] }))
    .sort((a, b) => a.order_num - b.order_num);

  res.json({ score: attempt.score, total: questions.length, answers });
});

// ─── Ovozli topshiriqlar: diktant (ovoz → matn) va o'qish (matn → ovoz) ──

app.get('/api/tasks', (req, res) => {
  const tasks = findAll('tasks')
    .sort((a, b) => a.sort_order - b.sort_order)
    .map(t => {
      const base = { id: t.id, type: t.type, title: t.title,
                     sort_order: t.sort_order, audio_url: t.audio_url || null };
      // O'qish topshirig'ida matn ko'rinishi shart.
      if (t.type === 'reading') return { ...base, text: t.text };
      // Diktantda audio bor bo'lsa — matn yuborilmaydi, javob oshkor bo'lmasin.
      // Audio yo'q bo'lsa — brauzer ovozi matnni o'qiydi, shuning uchun matn yuboriladi.
      return t.audio_url ? base : { ...base, text: t.text, tts_fallback: true };
    });
  res.json(tasks);
});

app.post('/api/tasks/dictation', (req, res) => {
  const { user_id, task_id, typed_text, elapsed_ms } = req.body;
  const user = findOne('users', u => u.id === parseInt(user_id));
  if (!user || user.is_admin) return res.status(403).json({ error: "Ruxsat yo'q" });
  const task = findOne('tasks', t => t.id === parseInt(task_id) && t.type === 'dictation');
  if (!task) return res.status(404).json({ error: 'Topshiriq topilmadi' });

  const elapsed = Math.max(0, parseInt(elapsed_ms) || 0);
  const graded = gradeDictation(task.text, typed_text, elapsed);

  deleteOne('task_results', r => r.user_id === user.id && r.task_id === task.id);
  const result = insert('task_results', {
    user_id: user.id, task_id: task.id, type: 'dictation',
    typed_text: String(typed_text == null ? '' : typed_text).slice(0, 5000),
    elapsed_ms: elapsed, ...graded
  });

  res.json({ success: true, result, reference: task.text });
});

app.post('/api/tasks/reading', audioUpload.single('audio'), (req, res) => {
  const user = findOne('users', u => u.id === parseInt(req.body.user_id));
  if (!user || user.is_admin) return res.status(403).json({ error: "Ruxsat yo'q" });
  const task = findOne('tasks', t => t.id === parseInt(req.body.task_id) && t.type === 'reading');
  if (!task) return res.status(404).json({ error: 'Topshiriq topilmadi' });
  if (!req.file) return res.status(400).json({ error: 'Ovoz yozuvi yuborilmadi' });

  // Eski yozuv bo'lsa — diskdan ham o'chiramiz, orfan fayl qolmasin
  const prev = findOne('task_results', r => r.user_id === user.id && r.task_id === task.id);
  if (prev && prev.recording_url) {
    const fp = path.join(AUDIO_DIR, path.basename(prev.recording_url));
    try { if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch {}
  }
  deleteOne('task_results', r => r.user_id === user.id && r.task_id === task.id);

  const result = insert('task_results', {
    user_id: user.id, task_id: task.id, type: 'reading',
    recording_url: `/uploads/audio/${req.file.filename}`,
    elapsed_ms: Math.max(0, parseInt(req.body.elapsed_ms) || 0)
  });

  res.json({ success: true, result });
});

app.get('/api/tasks/results/:userId', (req, res) => {
  const userId = parseInt(req.params.userId);
  res.json(findAll('task_results', r => r.user_id === userId));
});

// ─── Admin routes ──────────────────────────────────────────────────

function requireAdmin(idParam) {
  const id = parseInt(idParam);
  return findOne('users', u => u.id === id && u.is_admin);
}

app.get('/api/admin/students', (req, res) => {
  if (!requireAdmin(req.query.admin_id)) return res.status(403).json({ error: "Ruxsat yo'q" });
  const total = findAll('questions').length;
  const students = findAll('users', u => !u.is_admin)
    .map(u => {
      const attempt = findOne('attempts', a => a.user_id === u.id && a.completed_at);
      return { id: u.id, name: u.name, phone: u.phone, registered_at: u.created_at,
               address: u.address || null, passport_id: u.passport_id || null,
               parent_phone: u.parent_phone || null,
               restricted: !!u.restricted, restrict_reason: u.restrict_reason || null,
               restricted_at: u.restricted_at || null,
               score: attempt ? attempt.score : null, completed_at: attempt ? attempt.completed_at : null, total };
    })
    // Test topshirganlar yuqorida, ball bo'yicha kamayish tartibida.
    // Ball teng bo'lsa — oldinroq tugatgan yuqorida. Topshirmaganlar oxirida.
    .sort((a, b) => {
      const aDone = a.completed_at ? 1 : 0;
      const bDone = b.completed_at ? 1 : 0;
      if (aDone !== bDone) return bDone - aDone;
      if (!aDone) return new Date(b.registered_at) - new Date(a.registered_at);
      return (b.score - a.score) || (new Date(a.completed_at) - new Date(b.completed_at));
    });
  res.json(students);
});

/** Blokni ochadi va vaqtni noldan boshlaydi.
 *  Bu tugma shart: boshqa oynaga o'tish aniqlanishi ba'zan yanglishadi
 *  (telefonga qo'ng'iroq kelsa, bildirishnoma tushsa), shuning uchun
 *  xatoni tuzatish imkoni bo'lishi kerak. */
app.post('/api/admin/unrestrict/:userId', (req, res) => {
  if (!requireAdmin(req.body.admin_id)) return res.status(403).json({ error: "Ruxsat yo'q" });
  const id = parseInt(req.params.userId);
  if (!findOne('users', x => x.id === id)) return res.status(404).json({ error: 'Topilmadi' });

  updateOne('users', x => x.id === id, {
    restricted: false, restricted_at: null, restrict_reason: null
  });
  deleteOne('sessions', x => x.user_id === id);   // vaqt qaytadan 15 daqiqa
  res.json({ success: true });
});

app.get('/api/admin/student/:userId', (req, res) => {
  if (!requireAdmin(req.query.admin_id)) return res.status(403).json({ error: "Ruxsat yo'q" });
  const userId = parseInt(req.params.userId);
  const student = findOne('users', u => u.id === userId);
  if (!student) return res.status(404).json({ error: 'Topilmadi' });

  const attempt = findOne('attempts', a => a.user_id === userId && a.completed_at);
  if (!attempt) return res.json({ student: { ...student }, attempt: null, answers: [] });

  const questions = findAll('questions');
  const qMap = Object.fromEntries(questions.map(q => [q.id, q]));
  const answers = findAll('answers', a => a.attempt_id === attempt.id)
    .filter(a => qMap[a.question_id])   // o'chirilgan savolga tegishli javoblar tushib qoladi
    .map(a => ({ ...a, ...qMap[a.question_id] }))
    .sort((a, b) => a.order_num - b.order_num);

  res.json({ student: { ...student }, attempt, answers });
});

app.get('/api/admin/questions', (req, res) => {
  if (!requireAdmin(req.query.admin_id)) return res.status(403).json({ error: "Ruxsat yo'q" });
  res.json(findAll('questions').sort((a, b) => a.order_num - b.order_num));
});

app.post('/api/admin/questions', (req, res) => {
  const { admin_id, question_text, option_a, option_b, option_c, option_d, option_e, correct_answer, time_seconds, image_urls } = req.body;
  if (!requireAdmin(admin_id)) return res.status(403).json({ error: "Ruxsat yo'q" });
  const err = validateQuestion(req.body);
  if (err) return res.status(400).json({ error: err });

  const questions = findAll('questions');
  const maxOrder = questions.length ? Math.max(...questions.map(q => q.order_num)) : 0;
  const q = insert('questions', {
    question_text, option_a, option_b, option_c, option_d,
    option_e: (option_e && String(option_e).trim()) ? String(option_e).trim() : null,
    correct_answer, time_seconds: parseInt(time_seconds) || 30,
    image_urls: Array.isArray(image_urls) ? image_urls : [], order_num: maxOrder + 1
  });
  res.json({ success: true, question: q });
});

app.put('/api/admin/questions/:id', (req, res) => {
  const { admin_id, question_text, option_a, option_b, option_c, option_d, option_e, correct_answer, time_seconds, image_urls } = req.body;
  if (!requireAdmin(admin_id)) return res.status(403).json({ error: "Ruxsat yo'q" });
  const err = validateQuestion(req.body);
  if (err) return res.status(400).json({ error: err });

  const id = parseInt(req.params.id);
  const patch = {
    question_text, option_a, option_b, option_c, option_d,
    option_e: (option_e && String(option_e).trim()) ? String(option_e).trim() : null,
    correct_answer, time_seconds: parseInt(time_seconds) || 30,
    image_urls: Array.isArray(image_urls) ? image_urls : []
  };
  // option_images admin formasida tahrirlanmaydi — so'rovda kelmasa, eskisi saqlanadi
  if (req.body.option_images !== undefined) patch.option_images = req.body.option_images || null;
  updateOne('questions', q => q.id === id, patch);
  res.json({ success: true, question: findOne('questions', q => q.id === id) });
});

app.delete('/api/admin/questions/:id', (req, res) => {
  if (!requireAdmin(req.body.admin_id)) return res.status(403).json({ error: "Ruxsat yo'q" });
  deleteOne('questions', q => q.id === parseInt(req.params.id));
  res.json({ success: true });
});

// ─── Admin: ovozli topshiriqlar ─────────────────────────────────────

app.get('/api/admin/tasks', (req, res) => {
  if (!requireAdmin(req.query.admin_id)) return res.status(403).json({ error: "Ruxsat yo'q" });
  const results = findAll('task_results');
  const tasks = findAll('tasks')
    .sort((a, b) => a.sort_order - b.sort_order)
    .map(t => ({ ...t, done_count: results.filter(r => r.task_id === t.id).length }));
  res.json(tasks);
});

app.post('/api/admin/upload-audio', audioUpload.single('audio'), (req, res) => {
  if (!requireAdmin(req.body.admin_id)) return res.status(403).json({ error: "Ruxsat yo'q" });
  if (!req.file) return res.status(400).json({ error: 'Fayl yuklanmadi' });
  res.json({ success: true, url: `/uploads/audio/${req.file.filename}` });
});

app.post('/api/admin/tasks', (req, res) => {
  const { admin_id, type, title, text, audio_url } = req.body;
  if (!requireAdmin(admin_id)) return res.status(403).json({ error: "Ruxsat yo'q" });
  if (!['dictation', 'reading'].includes(type)) return res.status(400).json({ error: "Topshiriq turi noto'g'ri" });
  if (!title || !title.trim() || !text || !text.trim()) {
    return res.status(400).json({ error: 'Sarlavha va matn to\'ldirilishi shart' });
  }
  const tasks = findAll('tasks');
  const maxOrder = tasks.length ? Math.max(...tasks.map(t => t.sort_order || 0)) : 0;
  const task = insert('tasks', {
    type, title: title.trim(), text: text.trim(),
    audio_url: type === 'dictation' ? (audio_url || null) : null,
    sort_order: maxOrder + 1
  });
  res.json({ success: true, task });
});

app.put('/api/admin/tasks/:id', (req, res) => {
  const { admin_id, type, title, text, audio_url } = req.body;
  if (!requireAdmin(admin_id)) return res.status(403).json({ error: "Ruxsat yo'q" });
  if (!['dictation', 'reading'].includes(type)) return res.status(400).json({ error: "Topshiriq turi noto'g'ri" });
  const id = parseInt(req.params.id);
  if (!findOne('tasks', t => t.id === id)) return res.status(404).json({ error: 'Topilmadi' });
  updateOne('tasks', t => t.id === id, {
    type, title: String(title || '').trim(), text: String(text || '').trim(),
    audio_url: type === 'dictation' ? (audio_url || null) : null
  });
  res.json({ success: true, task: findOne('tasks', t => t.id === id) });
});

app.delete('/api/admin/tasks/:id', (req, res) => {
  if (!requireAdmin(req.body.admin_id)) return res.status(403).json({ error: "Ruxsat yo'q" });
  const id = parseInt(req.params.id);
  const task = findOne('tasks', t => t.id === id);

  // Topshiriqning o'z audiosi va unga tegishli barcha yozuvlarni diskdan tozalaymiz
  const files = findAll('task_results', r => r.task_id === id)
    .map(r => r.recording_url)
    .concat(task && task.audio_url ? [task.audio_url] : []);
  files.forEach(url => {
    if (!url) return;
    const fp = path.join(AUDIO_DIR, path.basename(url));
    try { if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch {}
  });
  deleteOne('task_results', r => r.task_id === id);
  deleteOne('tasks', t => t.id === id);
  res.json({ success: true });
});

/** O'quvchining ovozli topshiriqlari. BARCHA topshiriqlar qaytariladi —
 *  bajarilmaganlari ham ko'rinishi kerak, aks holda o'qituvchi kim nimani
 *  tashlab ketganini bilmaydi. Bajarilganlarida yozgan matni va ovoz
 *  yozuvi ham bo'ladi. */
app.get('/api/admin/task-results/:userId', (req, res) => {
  if (!requireAdmin(req.query.admin_id)) return res.status(403).json({ error: "Ruxsat yo'q" });
  const userId = parseInt(req.params.userId);

  const results = findAll('task_results', r => r.user_id === userId);
  const byTask = Object.fromEntries(results.map(r => [r.task_id, r]));
  const tasks = findAll('tasks');

  const rows = tasks
    .sort((a, b) => a.sort_order - b.sort_order)
    .map(t => {
      const r = byTask[t.id];
      return {
        task_id: t.id, type: t.type, task_title: t.title,
        reference_text: t.text, sort_order: t.sort_order,
        done: !!r,
        typed_text: r ? (r.typed_text || null) : null,
        recording_url: r ? (r.recording_url || null) : null,
        elapsed_ms: r ? r.elapsed_ms : null,
        accuracy: r ? r.accuracy : null,
        wer: r ? r.wer : null,
        wpm: r ? r.wpm : null,
        typed_words: r ? r.typed_words : null,
        ref_words: r ? r.ref_words : null,
        submitted_at: r ? r.created_at : null
      };
    });

  // Topshiriq o'chirilgan bo'lsa ham eski javob yo'qolib ketmasin
  const liveIds = new Set(tasks.map(t => t.id));
  const orphans = results.filter(r => !liveIds.has(r.task_id)).map(r => ({
    task_id: r.task_id, type: r.type, task_title: "O'chirilgan topshiriq",
    reference_text: null, sort_order: 999, done: true,
    typed_text: r.typed_text || null, recording_url: r.recording_url || null,
    elapsed_ms: r.elapsed_ms, accuracy: r.accuracy ?? null, wer: r.wer ?? null,
    wpm: r.wpm ?? null, typed_words: r.typed_words ?? null,
    ref_words: r.ref_words ?? null, submitted_at: r.created_at
  }));

  res.json(rows.concat(orphans));
});

// ─── Xatoliklarni bir joyda ushlash (multer fileFilter va h.k.) ─────
app.use((err, req, res, next) => {
  if (!err) return next();
  res.status(400).json({ error: err.message || 'Xatolik yuz berdi' });
});

app.listen(PORT, () => {
  console.log(`\n  AI Academy ishga tushdi!`);
  console.log(`  URL: http://localhost:${PORT}`);
  console.log(`  Admin telefon: 949303047\n`);
});
