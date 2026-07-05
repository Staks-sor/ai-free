import crypto from "node:crypto";

const cores = [8, 16, 24, 32];

const navigator_keys = [
  "webdriver−false",
  "userAgentData−[object NavigatorUAData]",
  "language−en-US",
  "cookieEnabled−true",
  "pdfViewerEnabled−true",
  "deviceMemory−8",
  "hardwareConcurrency−16",
  "maxTouchPoints−0",
  "doNotTrack−null"
];

const document_keys = [
  "location−https://chatgpt.com/",
  "referrer−",
  "title−ChatGPT",
  "readyState−complete",
  "visibilityState−visible"
];

const window_keys = [
  "chrome−[object Object]",
  "isSecureContext−true",
  "devicePixelRatio−1",
  "innerHeight−900",
  "innerWidth−1440"
];

function getParseTime() {
  const est = new Date(Date.now() - 5 * 3600 * 1000); // EST timezone (UTC-5)
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  
  const pad = (n) => String(n).padStart(2, '0');
  
  const dayName = days[est.getUTCDay()];
  const monthName = months[est.getUTCMonth()];
  const date = pad(est.getUTCDate());
  const year = est.getUTCFullYear();
  const h = pad(est.getUTCHours());
  const m = pad(est.getUTCMinutes());
  const s = pad(est.getUTCSeconds());
  
  return `${dayName} ${monthName} ${date} ${year} ${h}:${m}:${s} GMT-0500 (Eastern Standard Time)`;
}

export function getConfig(userAgent, cachedDpl = "prod-f501fe933b3edf57aea882da888e1a544df99840") {
  const screenRes = [1920 + 1080, 2560 + 1440, 1920 + 1200, 2560 + 1600][Math.floor(Math.random() * 4)];
  const navKey = navigator_keys[Math.floor(Math.random() * navigator_keys.length)];
  const docKey = document_keys[Math.floor(Math.random() * document_keys.length)];
  const winKey = window_keys[Math.floor(Math.random() * window_keys.length)];
  const coreCount = cores[Math.floor(Math.random() * cores.length)];
  
  // performance.now() equivalent
  const perfNow = Date.now() % 100000; 
  
  return [
    screenRes,
    getParseTime(),
    4294705152,
    0, // i placeholder
    userAgent,
    "https://chatgpt.com/backend-api/sentinel/sdk.js", // cached scripts
    cachedDpl,
    "en-US",
    "en-US,es-US,en,es",
    0, // j placeholder
    navKey,
    docKey,
    winKey,
    perfNow,
    crypto.randomUUID(),
    "",
    coreCount,
    Date.now() - perfNow,
  ];
}

export function generateAnswer(seed, diff, config) {
  const diffLen = diff.length;
  const seedBuf = Buffer.from(seed);
  const targetDiff = Buffer.from(diff, 'hex');

  const part1 = Buffer.from(JSON.stringify(config.slice(0, 3)).slice(0, -1) + ',');
  const part2 = Buffer.from(',' + JSON.stringify(config.slice(4, 9)).slice(1, -1) + ',');
  const part3 = Buffer.from(',' + JSON.stringify(config.slice(10)).slice(1));

  for (let i = 0; i < 500000; i++) {
    const dynamicI = Buffer.from(String(i));
    const dynamicJ = Buffer.from(String(i >> 1));
    const finalJson = Buffer.concat([part1, dynamicI, part2, dynamicJ, part3]);
    const baseEncoded = Buffer.from(finalJson.toString('base64'));
    
    const hash = crypto.createHash('sha3-512').update(Buffer.concat([seedBuf, baseEncoded])).digest();
    
    let match = true;
    for (let k = 0; k < diffLen / 2; k++) {
      if (hash[k] > targetDiff[k]) {
        match = false;
        break;
      } else if (hash[k] < targetDiff[k]) {
        break;
      }
    }
    if (match) {
      return { answer: baseEncoded.toString(), solved: true };
    }
  }

  // fallback
  const fallbackVal = Buffer.from(`"${seed}"`).toString('base64');
  return { answer: "wQ8Lk5FbGpA2NcR9dShT6gYjU7VxZ4D" + fallbackVal, solved: false };
}

export function getAnswerToken(seed, diff, config) {
  const { answer, solved } = generateAnswer(seed, diff, config);
  return { token: "gAAAAAB" + answer, solved };
}

export function getRequirementsToken(config) {
  const seed = String(Math.random());
  const { answer } = generateAnswer(seed, "0fffff", config);
  return 'gAAAAAC' + answer;
}
