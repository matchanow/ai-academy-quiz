# AI Academy — test platformasi

Akademiyaga o'quvchi tanlash uchun test tizimi. Test savollari va ovozli
topshiriqlar bitta oqimda aralash tartibda beriladi.

## Ishga tushirish

```bash
npm install
node server.js
```

`http://localhost:3000` — o'quvchi uchun, `/admin.html` — o'qituvchi uchun.

Savollar (`db/questions.json`) va ovozli topshiriqlar (`db/tasks.json`)
repoda saqlanadi — server aynan shu mazmun bilan ishga tushadi.

O'quvchilarning ma'lumotlari repoga kirmaydi: ism-familiya, telefon,
pasport / ID, ota-ona raqami, manzil, javoblar va ovoz yozuvlari. Ular
birinchi ishga tushganda bo'sh holda yaratiladi.

## Tuzilishi

| Fayl | Vazifasi |
|---|---|
| `server.js` | Express server, JSON-fayl bazasi, barcha API |
| `public/index.html` | Ro'yxatdan o'tish va kirish |
| `public/quiz.html` | Test oqimi: savollar + diktant + o'qish |
| `public/admin.html` | O'qituvchi paneli: savollar, natijalar, bloklar |
| `public/style.css` | Dizayn tizimi (brend rangi `#0A4629`) |
| `public/brandbook.html` | Brendbuk |
| `db/*.json` | Baza — repoga kirmaydi |

## Test qanday ishlaydi

**Bitta umumiy taymer — 15 daqiqa** butun testga. Muddat serverda
saqlanadi (`db/sessions.json`), shuning uchun sahifani qayta yuklash yoki
`localStorage`ni tozalash vaqtni tiklamaydi.

Bosqichlar har o'quvchi uchun tasodifiy tartibda aralashtiriladi:

- **Test savoli** — bir nechta variantdan bittasini tanlash
- **Diktant** — ovozni tinglab, eshitganini yozish. Javob avtomatik
  baholanadi: aniqlik (%), WER, terish tezligi (WPM)
- **O'qish mashqi** — matnni ovoz chiqarib o'qib, yozib olish

Diktantda audio bo'lsa matn brauzerga yuborilmaydi, aks holda javob
oshkor bo'lardi. Audio bo'lmasa brauzer ovozi (TTS) matnni o'qiydi.

## Qoidabuzarlik nazorati

Test rasmiy tanlov uchun, shuning uchun boshqa oynaga o'tish taqiqlangan:

- vkladka yashirilsa — `visibilitychange`
- oyna ko'rinib turib fokusni yo'qotsa (yonma-yon ochilgan ikkinchi
  oyna) — `window.blur` va `document.hasFocus()`

Fokus 1.2 soniya ichida qaytsa kechiriladi — bir lahzalik uzilishlar
uchun. Mikrofon ruxsati oynasi ham fokusni oladi, o'sha paytda nazorat
vaqtincha o'chiriladi.

Qoidabuzarlikda test bekor qilinadi va kirish taqiqlanadi. Qaytib kirish
uch belgi bo'yicha to'siladi: **telefon**, **pasport / ID** va
**ism-familiya**. Ism kaliti so'z tartibiga, harf registriga, apostrof va
alifboga bog'liq emas — `Suxrob Xaydarov`, `Xaydarov Suxrob`,
`Suhrob Haydarov` va `Хайдаров Сухроб` bitta kalitga tushadi.

Blokni admin panelda ochish mumkin — bu shart, chunki telefonga qo'ng'iroq
kelishi yoki bildirishnoma tushishi ham fokusni oladi va begunoh o'quvchi
bloklanib qolishi mumkin.

## Imkoniyati cheklangan o'quvchilar uchun

Test hamma uchun bir xil, lekin javob berish jismonan qulay bo'lishi kerak:

- javob variantlari haqiqiy `<button role="radio">` — sichqonchasiz,
  klaviatura yoki maxsus qurilma bilan javob berish mumkin
- yorliqlar: `1`–`5` yoki `A`–`E` variantni tanlaydi, strelkalar
  variantlar orasida yuradi, `Enter` keyingi bosqichga o'tadi
- bosish maydonlari kattalashtirilgan (variant 64px, tugma 48px)
- fokus halqasi hech qachon yashirilmaydi
- ARIA, `aria-live` bilan bosqich almashini ovozli e'lon qilish
- `prefers-reduced-motion` va `prefers-contrast` qo'llanadi

## Bilib qo'yish kerak

- **Admin panel parolsiz** — kirish faqat 9 xonali telefon raqami bilan
  (`server.js`, `/api/auth`). Ommaviy internetga chiqarishdan oldin
  albatta parol qo'yish kerak.
- **Pasport raqami tekshirilmaydi.** Bloklangan odam boshqa raqam yozib
  qayta ro'yxatdan o'tishi mumkin. Bu to'siq, kafolat emas.
- **Bir xil ismli o'quvchilar bir-birini bloklaydi.** Ism bo'yicha
  to'sish shunday ishlaydi; blokni ochish tugmasi shu uchun kerak.
