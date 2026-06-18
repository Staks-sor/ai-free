# AI Free

## अपनी भाषा चुनें

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

> मुफ्त AI वेब चैट को एक इंटरफ़ेस में लाने वाला CLI और डेस्कटॉप ऐप। फिलहाल **DeepSeek, Qwen और ChatGPT** समर्थित हैं। macOS, Linux और Windows पर चलता है।

## प्रोजेक्ट का समर्थन करें

अगर AI Free आपका समय बचाता है, तो [रिपॉजिटरी को स्टार दें](https://github.com/Staks-sor/ai-free)। इससे दूसरे लोगों को प्रोजेक्ट खोजने में मदद मिलती है।

- दान कार्ड (OTP Bank): `2201 9604 2500 7505`

## सुविधाएँ

- एक डेस्कटॉप विंडो में DeepSeek, Qwen और ChatGPT।
- हर प्रदाता के लिए स्वचालित लॉगिन और सत्र रिकवरी।
- कई चैट, हर चैट के लिए अलग प्रोजेक्ट फ़ोल्डर।
- workspace फ़ाइल एक्सेस और अनुमत कमांड वाला `/code` एजेंट।
- दीर्घकालिक मेमोरी, मेमोरी ग्राफ और दोबारा उपयोग होने वाली skills।
- IDE के लिए OpenAI और Anthropic-संगत स्थानीय API।
- वैकल्पिक Parakeet V3 बहुभाषी वॉइस इनपुट, जो पहली बार उपयोग पर डाउनलोड होता है।
- भाषा, API, अनुमतियों और एजेंट के लिए अलग सेटिंग्स।

## आवश्यकताएँ

- Node.js 18 या नया।
- npm।
- AI प्रदाताओं और Chromium की शुरुआती स्थापना के लिए इंटरनेट।

## स्थापना

### macOS और Linux

```bash
git clone https://github.com/Staks-sor/ai-free.git
cd ai-free
npm install
npm start
```

Linux पर:

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

पहली बार शुरू करते समय प्रदाता चुनें और ब्राउज़र विंडो में लॉगिन करें। सत्र स्थानीय रूप से सुरक्षित रहते हैं।

## मुख्य कमांड

| कमांड | काम |
|---|---|
| `npm start` | डेस्कटॉप चैट विंडो शुरू करें |
| `npm run cli` | टर्मिनल REPL शुरू करें |
| `npm run api` | `127.0.0.1:4318` पर स्थानीय API शुरू करें |
| `npm run login` | DeepSeek को दोबारा कनेक्ट करें |
| `npm run login-qwen` | Qwen को दोबारा कनेक्ट करें |
| `npm run login-chatgpt` | ChatGPT को दोबारा कनेक्ट करें |
| `npm test` | टेस्ट चलाएँ |

## स्थानीय API

```bash
npm run api
```

OpenAI-संगत बेस URL:

```text
http://127.0.0.1:4318/v1
```

API कुंजियाँ और प्रदाता विकल्प **सेटिंग्स → API** में उपलब्ध हैं।

## प्रोजेक्ट, मेमोरी और skills

नई चैट बनाते समय प्रोजेक्ट फ़ोल्डर चुनें। एजेंट के टूल केवल उसी workspace में काम करते हैं।

- **Coder** कार्य सीधे कोड एजेंट को भेजता है।
- **Memory** पुराने समाधान खोजती है और उपयोगी परिणाम सहेजती है।
- **Skill auto** कार्य के अनुसार skill चुनता है।
- `/skill <id> <कार्य>` से skill मैन्युअल रूप से चुनी जा सकती है।

विस्तृत आर्किटेक्चर: [मेमोरी और skills योजना](../AI_FREE_BRAINS_AND_SKILLS_PLAN.md)।

## स्थानीय डेटा और सुरक्षा

- DeepSeek और साझा चैट स्थिति: `~/.deepseek-cli/`
- Qwen: `~/.qwen-cli/`
- मेमोरी और skills: `~/.ai-free/`

टोकन और cookies कंप्यूटर पर ही रहते हैं। सर्वर केवल `127.0.0.1` पर सुनते हैं।

## समस्याएँ और लाइसेंस

प्रदाता को दोबारा जोड़ने के लिए उसका `login` कमांड चलाएँ। Chromium न हो तो `npx playwright install chromium` चलाएँ।

समस्या मिली? [Issue खोलें](https://github.com/Staks-sor/ai-free/issues)।

केवल व्यक्तिगत उपयोग के लिए। [LICENSE](../../LICENSE) देखें।
