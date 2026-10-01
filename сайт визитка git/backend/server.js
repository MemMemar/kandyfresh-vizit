require('dotenv').config();
const express = require('express');
const nodemailer = require('nodemailer');
const cors = require('cors');

const app = express();

// Middleware
app.use(cors({ 
  origin: process.env.FRONTEND_URL || 'http://localhost:5500',
  credentials: true 
}));
app.use(express.json({ limit: '10mb' }));

// ===== SMTP transporter =====
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// Проверка подключения
transporter.verify()
  .then(() => console.log('✅ SMTP подключён успешно'))
  .catch(err => console.error('❌ SMTP ошибка:', err.message));

// ===== Хранилище кодов (в продакшене используйте БД) =====
const codes = new Map();
const rateLimits = new Map();

function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function saveCode(email, code, type) {
  codes.set(email, {
    code,
    type,
    expires: Date.now() + 10 * 60 * 1000, // 10 минут
  });
}

function getCode(email, type) {
  const data = codes.get(email);
  if (!data) return null;
  if (data.expires < Date.now()) { codes.delete(email); return null; }
  if (data.type !== type) return null;
  return data.code;
}

function checkRateLimit(email) {
  const last = rateLimits.get(email) || 0;
  const waitMs = 60 * 1000; // 1 минута
  if (Date.now() - last < waitMs) {
    return Math.ceil((waitMs - (Date.now() - last)) / 1000);
  }
  rateLimits.set(email, Date.now());
  return 0;
}

// ===== Функция отправки письма =====
async function sendMail(to, subject, html) {
  return transporter.sendMail({
    from: `"KandyFresh Dev" <${process.env.SMTP_USER}>`,
    to,
    subject,
    html,
  });
}

// ===== ROUTES =====

// 1. Отправка кода при регистрации
app.post('/api/auth/send-code', async (req, res) => {
  try {
    const { email, nickname } = req.body;
    if (!email) return res.status(400).json({ error: 'Email обязателен' });

    const wait = checkRateLimit(email);
    if (wait > 0) return res.status(429).json({ error: `Подождите ${wait} сек.` });

    const code = generateCode();
    saveCode(email, code, 'register');

    await sendMail(
      email,
      'Подтверждение регистрации — KandyFresh Dev',
      `<div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:20px;background:#f5f5f5">
        <div style="background:#fff;padding:30px;border-radius:10px;box-shadow:0 2px 10px rgba(0,0,0,0.1)">
          <h2 style="color:#e63946;margin-top:0">Привет, ${nickname || 'друг'}! 👋</h2>
          <p>Спасибо за регистрацию на KandyFresh Dev!</p>
          <p>Ваш код подтверждения:</p>
          <div style="background:#1a1a1a;color:#fff;font-size:32px;font-weight:bold;
                      letter-spacing:8px;text-align:center;padding:20px;border-radius:10px;
                      margin:20px 0">${code}</div>
          <p style="color:#666;font-size:14px">Код действителен 10 минут.<br>
          Если вы не регистрировались — просто проигнорируйте это письмо.</p>
          <hr style="border:none;border-top:1px solid #eee;margin:20px 0">
          <p style="color:#999;font-size:12px">KandyFresh Dev · Сайты на заказ</p>
        </div>
      </div>`
    );

    console.log(`✅ Код отправлен на ${email}: ${code}`);
    res.json({ success: true, message: 'Код отправлен на ' + email });
  } catch (err) {
    console.error('❌ Ошибка отправки:', err);
    res.status(500).json({ error: 'Ошибка отправки: ' + err.message });
  }
});

// 2. Отправка кода для восстановления пароля
app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email обязателен' });

    const wait = checkRateLimit(email);
    if (wait > 0) return res.status(429).json({ error: `Подождите ${wait} сек.` });

    const code = generateCode();
    saveCode(email, code, 'reset');

    await sendMail(
      email,
      'Восстановление пароля — KandyFresh Dev',
      `<div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:20px;background:#f5f5f5">
        <div style="background:#fff;padding:30px;border-radius:10px;box-shadow:0 2px 10px rgba(0,0,0,0.1)">
          <h2 style="color:#e63946;margin-top:0">Восстановление пароля 🔑</h2>
          <p>Вы запросили сброс пароля для аккаунта KandyFresh Dev.</p>
          <p>Ваш код для сброса пароля:</p>
          <div style="background:#1a1a1a;color:#fff;font-size:32px;font-weight:bold;
                      letter-spacing:8px;text-align:center;padding:20px;border-radius:10px;
                      margin:20px 0">${code}</div>
          <p style="color:#666;font-size:14px">Код действителен 10 минут.</p>
          <hr style="border:none;border-top:1px solid #eee;margin:20px 0">
          <p style="color:#999;font-size:12px">KandyFresh Dev · Сайты на заказ</p>
        </div>
      </div>`
    );

    console.log(`✅ Код восстановления отправлен на ${email}: ${code}`);
    res.json({ success: true });
  } catch (err) {
    console.error('❌ Ошибка:', err);
    res.status(500).json({ error: err.message });
  }
});

// 3. Рассылка (для админа)
app.post('/api/mailing', async (req, res) => {
  try {
    const { subject, body, recipients } = req.body;
    if (!subject || !body || !recipients?.length) {
      return res.status(400).json({ error: 'Не все поля заполнены' });
    }

    let sent = 0;
    for (const email of recipients) {
      try {
        await sendMail(email, subject, `
          <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;background:#f5f5f5">
            <div style="background:#fff;padding:30px;border-radius:10px;box-shadow:0 2px 10px rgba(0,0,0,0.1)">
              <h2 style="color:#e63946;margin-top:0">${subject}</h2>
              <div style="line-height:1.6;color:#333">${body.replace(/\n/g, '<br>')}</div>
              <hr style="border:none;border-top:1px solid #eee;margin:20px 0">
              <p style="color:#999;font-size:12px">KandyFresh Dev · Сайты на заказ</p>
            </div>
          </div>
        `);
        sent++;
      } catch (e) { 
        console.error('❌ Ошибка отправки на', email, e.message); 
      }
    }

    console.log(`✅ Рассылка отправлена: ${sent}/${recipients.length}`);
    res.json({ success: true, sent });
  } catch (err) {
    console.error('❌ Ошибка рассылки:', err);
    res.status(500).json({ error: err.message });
  }
});

// ===== Запуск =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🚀 Сервер запущен на http://localhost:${PORT}`);
  console.log(`📧 SMTP: ${process.env.SMTP_USER}`);
  console.log(`🌐 CORS: ${process.env.FRONTEND_URL}\n`);
});