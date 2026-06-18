# AI Free

## اختر لغتك

<p>
  <a href="../../README.md"><img src="https://img.shields.io/badge/Русский-0969da?style=for-the-badge" height="30" alt="Русский"></a>
  <a href="README.en.md"><img src="https://img.shields.io/badge/English-1f883d?style=for-the-badge" height="30" alt="English"></a>
  <a href="README.es.md"><img src="https://img.shields.io/badge/Español-d29922?style=for-the-badge" height="30" alt="Español"></a>
  <a href="README.pt.md"><img src="https://img.shields.io/badge/Português-8250df?style=for-the-badge" height="30" alt="Português"></a>
  <a href="README.de.md"><img src="https://img.shields.io/badge/Deutsch-cf222e?style=for-the-badge" height="30" alt="Deutsch"></a>
  <a href="README.fr.md"><img src="https://img.shields.io/badge/Français-0550ae?style=for-the-badge" height="30" alt="Français"></a>
  <a href="README.zh.md"><img src="https://img.shields.io/badge/中文-b35900?style=for-the-badge" height="30" alt="中文"></a>
  <a href="README.hi.md"><img src="https://img.shields.io/badge/हिन्दी-9a6700?style=for-the-badge" height="30" alt="हिन्दी"></a>
  <a href="README.ar.md"><img src="https://img.shields.io/badge/العربية-1a7f37?style=for-the-badge" height="30" alt="العربية"></a>
</p>

> أداة سطر أوامر وتطبيق سطح مكتب يجمعان محادثات الذكاء الاصطناعي المجانية في واجهة واحدة. يدعم حاليًا **DeepSeek وQwen وChatGPT** على macOS وLinux وWindows.

## دعم المشروع

إذا وفّر عليك AI Free الوقت، يمكنك [إضافة نجمة للمستودع](https://github.com/Staks-sor/ai-free). هذا يساعد الآخرين على اكتشاف المشروع.

- بطاقة التبرع (OTP Bank): `2201 9604 2500 7505`

## المزايا

- DeepSeek وQwen وChatGPT في نافذة سطح مكتب واحدة.
- تسجيل دخول تلقائي واستعادة الجلسة لكل مزود.
- محادثات متعددة، لكل منها مجلد مشروع مستقل.
- وكيل `/code` مع وصول إلى ملفات مساحة العمل والأوامر المسموح بها.
- ذاكرة طويلة المدى ورسم بياني للذاكرة وskills قابلة لإعادة الاستخدام.
- واجهات API محلية متوافقة مع OpenAI وAnthropic لتكاملات IDE.
- إدخال صوتي اختياري متعدد اللغات باستخدام Parakeet V3، يُنزّل عند أول استخدام فقط.
- إعدادات مستقلة للغة وAPI والصلاحيات والوكيل.

## المتطلبات

- Node.js الإصدار 18 أو أحدث.
- npm.
- اتصال بالإنترنت لمزودي الذكاء الاصطناعي ولتثبيت Chromium أول مرة.

## التثبيت

### macOS وLinux

```bash
git clone https://github.com/Staks-sor/ai-free.git
cd ai-free
npm install
npm start
```

على Linux:

```bash
sudo npx playwright install-deps chromium
```

### Windows

```powershell
git clone https://github.com/Staks-sor/ai-free.git
cd ai-free
npm install
npm start
```

عند التشغيل الأول، اختر المزودين وسجّل الدخول من نافذة المتصفح. تُحفظ الجلسات محليًا وتُستخدم في المرات التالية.

## الأوامر الأساسية

| الأمر | الوظيفة |
|---|---|
| `npm start` | تشغيل نافذة المحادثة |
| `npm run cli` | تشغيل REPL في الطرفية |
| `npm run api` | تشغيل API المحلي على `127.0.0.1:4318` |
| `npm run login` | إعادة ربط DeepSeek |
| `npm run login-qwen` | إعادة ربط Qwen |
| `npm run login-chatgpt` | إعادة ربط ChatGPT |
| `npm test` | تشغيل الاختبارات |

## API المحلي

```bash
npm run api
```

عنوان الأساس المتوافق مع OpenAI:

```text
http://127.0.0.1:4318/v1
```

توجد مفاتيح API وخيارات المزودين في **الإعدادات ← API**.

## المشاريع والذاكرة وskills

عند إنشاء محادثة، اختر مجلد المشروع. تعمل أدوات الوكيل داخل مساحة العمل المختارة فقط.

- **Coder** يرسل المهام مباشرة إلى وكيل البرمجة.
- **Memory** تسترجع الحلول السابقة وتحفظ النتائج المفيدة.
- **Skill auto** يختار skill تلقائيًا حسب المهمة.
- `/skill <id> <المهمة>` يختار skill يدويًا.

تفاصيل البنية: [خطة الذاكرة وskills](../AI_FREE_BRAINS_AND_SKILLS_PLAN.md).

## البيانات المحلية والأمان

- DeepSeek وحالة المحادثات المشتركة: `~/.deepseek-cli/`
- Qwen: `~/.qwen-cli/`
- الذاكرة وskills: `~/.ai-free/`

تبقى الرموز وملفات cookies على الجهاز. تستمع الخوادم على `127.0.0.1` فقط.

## المشاكل والترخيص

استخدم أمر `login` الخاص بالمزود لإعادة الاتصال. إذا كان Chromium مفقودًا، شغّل `npx playwright install chromium`.

وجدت مشكلة؟ [افتح Issue](https://github.com/Staks-sor/ai-free/issues).

للاستخدام الشخصي فقط. راجع [LICENSE](../../LICENSE).
