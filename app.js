/************************************************************
 * 0) CONFIG
 ************************************************************/
const MODEL_URL = "https://teachablemachine.withgoogle.com/models/4nP7aQpCm/";
const TOP_K = 3;
const LOW_CONF = 0.6;
const CAM_INFER_MS = 300;

const EMOJI = {
  happy: "🙂 Happy",
  sad: "😢 Sad",
  angry: "😠 Angry",
  neutral: "😐 Neutral"
};

const MOOD_TO_STYLE = {
  happy: "Active",
  neutral: "Minimal",
  sad: "Cozy",
  angry: "Street"
};


/************************************************************
 * 1) DOM REFERENCES
 ************************************************************/
const el = id => document.getElementById(id);

const $status = el("status");
const $msg = el("msg");
const $video = el("video");
const $img = el("img");
const $canvas = el("canvas");
const $pred = el("predictions");
const $bars = el("bars");
const $guide = el("guidance");
const $err = el("errorBox");
const $ok = el("okBox");
const $progress = el("progress");
const $progressBox = el("progressBox");

const $btnCam = el("btnCam");
const $file = el("file");
const $btnReset = el("btnReset");
const $btnNextWeather = el("btnNextWeather");

const $weatherSection = el("weather-section");
const $genderSection = el("gender-section");
const $finalSection = el("final-section");
const $predSection = el("pred-section");

const $btnRestart = el("btnRestart");
const $btnCapture = el("btnCapture");
const $countdown = el("countdown");
const $weatherResult = el("weatherResult");
const grid = document.getElementById("card-grid");

// State
let step = 1;
let selectedEmotion = null;
let selectedStyle = null;
let selectedWeather = null;
let selectedGender = null; 

let model, maxPredictions;
let webcamStream = null;
let lastInfer = 0;
let isCountingDown = false;


/************************************************************
 * 2) HELPER FUNCTIONS (announce, error, etc.)
 ************************************************************/
function announce(html, cls = "") {
  $msg.className = cls || "";
  $msg.innerHTML = html;
  $msg.classList.remove("hidden");
}

function setError(e) {
  $err.textContent = e;
  $err.classList.remove("hidden");
  $ok.classList.add("hidden");
}

function setOk(t = "System is running normally.") {
  $ok.textContent = t;
  $ok.classList.remove("hidden");
  $err.classList.add("hidden");
}


/************************************************************
 * 3) LOAD MODEL
 ************************************************************/
async function loadModel() {
  try {
    if (typeof tmImage === "undefined") {
      throw new Error("Teachable Machine library not loaded.");
    }

    $status.textContent = "Loading model…";
    $progressBox.classList.remove("hidden");

    let p = 0;
    const t = setInterval(() => {
      p = Math.min(p + 8, 96);
      $progress.value = p;
    }, 120);

    const modelURL = MODEL_URL + "model.json";
    const metadataURL = MODEL_URL + "metadata.json";

    const [headModel, headMeta] = await Promise.all([
      fetch(modelURL),
      fetch(metadataURL)
    ]);

    if (!headModel.ok) throw new Error("model.json load failed.");
    if (!headMeta.ok) throw new Error("metadata.json load failed.");

    model = await tmImage.load(modelURL, metadataURL);
    clearInterval(t);
    $progress.value = 100;

    setTimeout(() => $progressBox.classList.add("hidden"), 300);

    maxPredictions = model.getTotalClasses();
    setOk(`Model loaded (${maxPredictions} classes).`);
    $btnCam.disabled = false;
    $status.textContent = "Ready. Choose an input to start.";
  } catch (e) {
    console.error(e);
    setError("Failed to load model: " + e.message);
    $status.textContent = "Stopped due to error.";
  }
}


/************************************************************
 * 4) FILE UPLOAD
 ************************************************************/
$file.addEventListener("change", ev => {
  try {
    const f = ev.target.files && ev.target.files[0];
    if (!f) {
      announce("No file selected.", "muted");
      return;
    }
    if (!f.type.startsWith("image/")) {
      setError("This is not a valid image file.");
      return;
    }

    stopCamera();
    $video.classList.add("hidden");
    $img.classList.remove("hidden");

    const url = URL.createObjectURL(f);

    $img.onload = async () => {
      URL.revokeObjectURL(url);
      try {
        await predictOnce($img);
      } catch (e) {
        setError("Error predicting image: " + e.message);
      }
    };

    $img.src = url;
  } catch (e) {
    setError("Error while processing file: " + e.message);
  }
});


/************************************************************
 * 5) CAMERA
 ************************************************************/
async function startCamera() {
  try {
    stopCamera();
    $status.textContent = "Requesting camera permission…";

    webcamStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user" },
      audio: false
    });

    $video.srcObject = webcamStream;
    $video.muted = true;

    await $video.play();

    $img.classList.add("hidden");
    $video.classList.remove("hidden");
    $btnCapture.disabled = false;

    $status.textContent = "Camera input active…";
    $btnCam.textContent = "Stop Camera";
  } catch (e) {
    console.error(e);
    setError("Unable to start camera: " + e.message);
  }
}

function stopCamera() {
  if (webcamStream) {
    webcamStream.getTracks().forEach(t => t.stop());
    webcamStream = null;
  }
  isCountingDown = false;
  $countdown.classList.add("hidden");
  $btnCapture.disabled = true;
  $btnCam.textContent = "Start Camera";
}

$btnCam.addEventListener("click", () => {
  if (webcamStream) stopCamera();
  else startCamera();
});


/************************************************************
 * 6) CAPTURE (3s TIMER)
 ************************************************************/
$btnCapture.addEventListener("click", startCountdownAndCapture);

function startCountdownAndCapture() {
  if (!webcamStream) {
    announce("Please turn on the camera first.", "muted");
    return;
  }
  if (isCountingDown) return;

  isCountingDown = true;

  let count = 3;
  $countdown.textContent = count;
  $countdown.classList.remove("hidden");

  const timer = setInterval(async () => {
    count--;
    if (count > 0) {
      $countdown.textContent = count;
    } else {
      clearInterval(timer);
      $countdown.classList.add("hidden");
      isCountingDown = false;

      try {
        await predictOnce($video);
      } catch (e) {
        setError("Camera prediction error: " + e.message);
      }
    }
  }, 1000);
}


/************************************************************
 * 7) INFERENCE (predictOnce)
 ************************************************************/
async function predictOnce(src) {
  if (!model) {
    announce("Please load model first.", "muted");
    return;
  }

  const W = 224,
    H = 224;
  $canvas.width = W;
  $canvas.height = H;

  const ctx = $canvas.getContext("2d");
  ctx.drawImage(src, 0, 0, W, H);

  const preds = await model.predict($canvas);
  const sorted = preds.sort((a, b) => b.probability - a.probability).slice(0, TOP_K);

  $pred.textContent = sorted
    .map(p => `${p.className.padEnd(12, " ")} ${(p.probability * 100).toFixed(1)}%`)
    .join("\n");

  renderBars(sorted);

  const best = sorted[0];
  if (best && best.probability < LOW_CONF) {
    $guide.innerHTML =
      "Low confidence. Improve lighting, reduce background noise, and retry.";
  } else {
    $guide.textContent = "";
  }

  if (best) {
    const label = best.className.toLowerCase();
    let emote = null;

    if (label.includes("happy")) emote = "happy";
    else if (label.includes("neutral")) emote = "neutral";
    else if (label.includes("sad")) emote = "sad";
    else if (label.includes("angry")) emote = "angry";

    if (emote) setEmotionAndEnableNext(emote);
  }

  setOk();
}


/************************************************************
 * 8) EMOTION SET + Next Weather
 ************************************************************/
function setEmotionAndEnableNext(emote) {
  selectedEmotion = emote;
  selectedStyle = MOOD_TO_STYLE[emote] || null;

  $btnNextWeather.disabled = !selectedStyle;

  if (selectedStyle) {
    announce(
      `Emotion: <strong>${emote}</strong> → Style: <strong>${selectedStyle}</strong>`,
      "muted"
    );
  }
}

["pickHappy", "pickNeutral", "pickSad", "pickAngry"].forEach(id => {
  const b = el(id);
  b.addEventListener("click", () => {
    const m = b.getAttribute("data-emote");
    if (m) setEmotionAndEnableNext(m);
  });
});

$btnNextWeather.addEventListener("click", gotoWeatherStep);


/************************************************************
 * 9) WEATHER API (weather_code + temperature)
 ************************************************************/
async function fetchWeatherByLatLon(lat, lon) {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=weather_code,temperature_2m`;

  const res = await fetch(url);
  if (!res.ok) throw new Error("Weather API error " + res.status);

  const data = await res.json();

  if (!data.current) throw new Error("Invalid weather API response");

  return {
    code: data.current.weather_code,
    temp: data.current.temperature_2m
  };
}

function mapCodeToWeatherText(code) {
  if ([0, 1].includes(code)) return "Sunny";
  if ([2, 3, 45, 48].includes(code)) return "Cloudy";
  return "Rainy";
}

// 🌫 Fetch fine dust (PM10) and ultrafine dust (PM2.5)
async function fetchDustByLatLon(lat, lon) {
  const url =
    `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}` +
    `&current=pm10,pm2_5`;

  const res = await fetch(url);
  if (!res.ok) throw new Error("Air quality API error " + res.status);

  const data = await res.json();

  if (!data.current || typeof data.current.pm10 === "undefined") {
    throw new Error("Invalid air quality API response");
  }

  return {
    pm10: data.current.pm10,
    pm2_5: data.current.pm2_5
  };
}

// 🌡 Dust level grading (English labels)
function gradePm10(v) {
  if (v <= 30) return { label: "Good", level: 0 };
  if (v <= 80) return { label: "Moderate", level: 1 };
  if (v <= 150) return { label: "Unhealthy", level: 2 };
  return { label: "Very Unhealthy", level: 3 };
}

function gradePm25(v) {
  if (v <= 15) return { label: "Good", level: 0 };
  if (v <= 35) return { label: "Moderate", level: 1 };
  if (v <= 75) return { label: "Unhealthy", level: 2 };
  return { label: "Very Unhealthy", level: 3 };
}

// 😷 One-line mask recommendation by overall level
function maskMessageForLevel(level) {
  if (level === 0) {
    return "No mask needed. The air quality is clean today.";
  }
  if (level === 1) {
    return "A light KF-AD mask is recommended if you are sensitive.";
  }
  if (level === 2) {
    return "A KF80 or higher mask is recommended.";
  }
  // level === 3
  return "A KF94 mask is strongly recommended; limit outdoor activities.";
}



/************************************************************
 * 10) AUTO WEATHER DETECTION
 ************************************************************/
/************************************************************
 * 10) AUTO WEATHER DETECTION
 ************************************************************/
async function autoSetWeather() {
  if (!$weatherResult) return;

  $weatherResult.textContent = "Detecting your current weather...";

  if (!navigator.geolocation) {
    $weatherResult.textContent = "Geolocation not supported.";
    return;
  }

  navigator.geolocation.getCurrentPosition(
    async pos => {
      try {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;

        // Fetch weather and dust data in parallel
        const [weather, dust] = await Promise.all([
          fetchWeatherByLatLon(lat, lon),
          fetchDustByLatLon(lat, lon)
        ]);

        const w = mapCodeToWeatherText(weather.code);
        selectedWeather = w;

        // Round dust values
        const pm10 = Math.round(dust.pm10);
        const pm25 = Math.round(dust.pm2_5);

        // Grade each dust value
        const g10 = gradePm10(pm10);
        const g25 = gradePm25(pm25);

        // Use the worse (higher) level for overall mask advice
        const overallLevel = Math.max(g10.level, g25.level);
        const maskMsg = maskMessageForLevel(overallLevel);

        // Render result in English
        $weatherResult.innerHTML = `
          Weather: <strong>${w}</strong><br>
          Temperature: <strong>${weather.temp}°C</strong><br>
          Fine dust (PM10): <strong>${pm10} µg/m³</strong> (${g10.label})<br>
          Ultrafine dust (PM2.5): <strong>${pm25} µg/m³</strong> (${g25.label})<br>
          <span style="display:inline-block;margin-top:6px;">
            😷 ${maskMsg}
          </span>
        `;
      } catch (e) {
        console.error(e);
        $weatherResult.textContent = "Weather detection failed.";
      }
    },
    err => {
      console.error(err);
      $weatherResult.textContent = "Weather detection blocked.";
    }
  );
}

/************************************************************
 * 11) GO TO WEATHER STEP
 ************************************************************/
function gotoWeatherStep() {
  if (!selectedStyle) {
    announce("Select emotion first.", "muted");
    return;
  }

  step = 2;
  $predSection.classList.add("hidden");
  $weatherSection.classList.remove("hidden");
  $finalSection.classList.add("hidden");

  autoSetWeather();
}

function gotoGenderStep() {
  // 날씨 섹션 숨기고 성별 섹션 보여주기
  $weatherSection.classList.add("hidden");
  $genderSection.classList.remove("hidden");
}

document.querySelectorAll("#gender-section button[data-gender]").forEach(btn => {
  btn.addEventListener("click", () => {
    selectedGender = btn.getAttribute("data-gender");
    showFinalCard();
  });
});




$weatherSection.querySelectorAll("button[data-weather]").forEach(btn => {
  btn.addEventListener("click", () => {
    selectedWeather = btn.getAttribute("data-weather");
    gotoGenderStep();
  });
});



/************************************************************
 * 12) FINAL RECOMMENDATIONS
 ************************************************************/
function showFinalCard() {
  if (!selectedStyle || !selectedWeather || !selectedGender) {
    announce("Missing weather, emotion, or gender.", "muted");
    return;
  }

  // 1) 기본 추천 카드 찾기 (성별은 여기서 안 씀)
  const base = RECOMMENDATIONS.find(
    card => card.mood === selectedStyle && card.weather === selectedWeather
  );

  if (!base) {
    renderCards([]);
    announce("No matching recommendation found.", "muted");
    return;
  }

  // 2) 렌더용으로 얕은 복사 (원본 데이터 보호)
  const cardForRender = { ...base };

  // 3) 성별이 Male이면 파일명 뒤에 '1' 붙인 버전 사용
  if (selectedGender === "Male" && cardForRender.hero) {
    const dotIndex = cardForRender.hero.lastIndexOf(".");
    if (dotIndex > -1) {
      cardForRender.hero =
        cardForRender.hero.substring(0, dotIndex) +
        "1" +
        cardForRender.hero.substring(dotIndex);
    }
    
    if (base.description_male) {
      cardForRender.description = base.description_male;
    }
    
  }

  // 4) 카드 렌더링
  renderCards([cardForRender]);

  // 5) 화면 전환 (성별 섹션 숨기고 Final 보이기)
  $predSection.classList.add("hidden");
  $weatherSection.classList.add("hidden");
  $genderSection.classList.add("hidden");
  $finalSection.classList.remove("hidden");

  $finalSection.scrollIntoView({ behavior: "smooth" });
}


/************************************************************
 * 13) RESET / RESTART
 ************************************************************/
$btnRestart.addEventListener("click", () => {
  selectedEmotion = null;
  selectedStyle = null;
  selectedWeather = null;
  selectedGender = null;   

  $predSection.classList.remove("hidden");
  $weatherSection.classList.add("hidden");
  $genderSection.classList.add("hidden"); 
  $finalSection.classList.add("hidden");

  $pred.textContent = "Waiting for results…";
  $guide.textContent = "";
  $btnNextWeather.disabled = true;

  stopCamera();
  $video.classList.add("hidden");
  $img.classList.add("hidden");

  setOk("Restarting...");
});

$btnReset.addEventListener("click", () => {
  stopCamera();
  $video.classList.add("hidden");

  $img.src = "";
  $img.classList.add("hidden");

  $pred.textContent = "Waiting for results…";
  $guide.textContent = "";

  announce("Reset complete.", "muted");
});


/************************************************************
 * 14) BAR CHART
 ************************************************************/
function renderBars(list) {
  $bars.innerHTML = "";

  const top1 = list[0];

  list.forEach(p => {
    const pct = Math.round(p.probability * 100);
    const raw = p.className.toLowerCase();

    let key = "neutral";
    if (raw.includes("happy")) key = "happy";
    else if (raw.includes("sad")) key = "sad";
    else if (raw.includes("angry")) key = "angry";

    const display = p === top1 ? `🔥 ${EMOJI[key]}` : EMOJI[key];

    const row = document.createElement("div");
    row.className = "bar-row";
    row.innerHTML = `
      <div class="bar-label">${display}</div>
      <div class="bar-track">
        <div class="bar-fill" style="width:${pct}%;"></div>
      </div>
      <div class="bar-pct">${pct}%</div>
    `;

    $bars.appendChild(row);

    setTimeout(() => {
      row.querySelector(".bar-fill").classList.add("show");
    }, 10);
  });
}

function renderCards(list){
  if (!grid || !Array.isArray(list)) return;

  grid.style.gridTemplateColumns = "1fr";  // 1열 유지
  grid.innerHTML = '';

  list.forEach(card => {
    const el = document.createElement('article');
    el.className = 'rec-card';
    el.style.cssText =
      'display:flex;' +
      'gap:20px;' +
      'align-items:flex-start;' +
      'border:1px solid #eee;' +
      'border-radius:12px;' +
      'padding:16px;' +
      'background:#fff;' +
      'box-shadow:0 6px 20px rgba(0,0,0,.06);' +
      'flex-wrap:wrap;';

      const heroImg = `
      <div style="flex:0 0 360px; max-width:360px;">
        <img
          src="${card.hero || 'assets_img/placeholder.jpg'}"
          alt="${card.title}"
          style="width:100%; height:auto; border-radius:18px; object-fit:cover;"
        >
      </div>
    `;    

    
    
    
    const textBlock = `
    <div class="rec-textbox" style="flex:1; min-width:260px; margin-bottom:12px;">
      <h3 style="margin:0 0 6px; font-size:22px;">${card.title}</h3>
  
      <p style="margin:0 0 6px; color:#666; line-height:1.4;">
        <strong>${card.mood}</strong> · ${card.weather}<br>
        <span style="background:#f5f5f5; border-radius:8px; padding:2px 6px;">
          ${card.palette_text || ''}
        </span>
      </p>
  
      <div style="margin-top:10px;">
        <strong>Items</strong>
        <ul style="margin:4px 0 10px; padding-left:18px;">
          ${(card.items || []).map(i => `<li>${i}</li>`).join('')}
        </ul>
  
        <strong>Accessories</strong>
        <ul style="margin:4px 0 10px; padding-left:18px;">
          ${(card.accessories || []).map(a => `<li>${a}</li>`).join('')}
        </ul>
      </div>
  
      <p style="margin:8px 0 0; color:#444; line-height:1.5;">
        ${card.description || ''}
      </p>
  
      <!-- 🌟 Why this works (설득 구조) -->
      <p style="margin-top:12px; color:#333; font-size:15px; font-weight:600;">
        Why this works:
      </p>
      <p style="margin-top:4px; color:#555; line-height:1.5;">
        ${card.reason || "This recommendation fits your detected mood and weather conditions."}
      </p>
  
      <!-- 🌟 Explainable AI 영역 -->
      <div class="rec-explain">
        <strong>How this recommendation was generated:</strong><br>
        • Facial expression recognized using a Teachable Machine model<br>
        • Weather detected via Open-Meteo API<br>
        • Gender-based asset selection logic applied<br>
        • Matched using a mood-to-style mapping system
      </div>
  
    </div>
  `;
  

    el.innerHTML = textBlock + heroImg;
    grid.appendChild(el);
  });
}


/************************************************************
 * 16) RECOMMENDATION DATA
 ************************************************************/
const RECOMMENDATIONS = [
  { id:"active_sunny", title:"Active × Sunny", mood:"Active", weather:"Sunny",
    hero:"assets_img/active_sunny.jpg",
    palette_text:"Red / Orange / Yellow",
    items:["Cotton T-shirt","Mini skirt","Sneakers"],
    accessories:["Sunglasses","Cap","Beaded bracelet"],
    description:"Bright energy for sunny weather." },

  { id:"active_cloudy", title:"Active × Cloudy", mood:"Active", weather:"Cloudy",
    hero:"assets_img/active_cloudy.jpg",
    palette_text:"Red / Orange / Yellow (toned down)",
    items:["T-shirt + cardigan","Light pants"],
    accessories:["Bucket hat","Crossbody bag"],
    description:"Stay light and energetic on cloudy days." },

  { id:"active_rainy", title:"Active × Rainy", mood:"Active", weather:"Rainy",
    hero:"assets_img/active_rainy.jpg",
    palette_text:"Bright inner + rain outer",
    items:["Rain jacket","Long pants"],
    accessories:["Umbrella","Backpack"],
    description:"Energy inside, protection outside." },

  { id:"minimal_sunny", title:"Minimal × Sunny", mood:"Minimal", weather:"Sunny",
    hero:"assets_img/minimal_sunny.jpg",
    palette_text:"Beige / Light Blue / White",
    items:["Light blue shirt","White pants"],
    accessories:["Leather tote","Metal watch"],
    description:"Clean bright minimal look." },

  { id:"minimal_cloudy", title:"Minimal × Cloudy", mood:"Minimal", weather:"Cloudy",
    hero:"assets_img/minimal_cloudy.jpg",
    palette_text:"Soft beige & blue",
    items:["Shirt + cardigan","Chinos"],
    accessories:["Slim belt","Minimal sneakers"],
    description:"Balanced tones for cloudy day stability." },

  { id:"minimal_rainy", title:"Minimal × Rainy", mood:"Minimal", weather:"Rainy",
    hero:"assets_img/minimal_rainy.jpg",
    palette_text:"Rain-friendly neutrals",
    items:["Beige trench","Shirt","Slacks"],
    accessories:["Tote bag","Watch"],
    description:"Keep it clean even in the rain." },

  { id:"cozy_sunny", title:"Cozy × Sunny", mood:"Cozy", weather:"Sunny",
    hero:"assets_img/cozy_sunny.jpg",
    palette_text:"Navy / Black / Gray",
    items:["Light knit","Relaxed pants"],
    accessories:["Soft scarf","Canvas bag"],
    description:"Relaxed cozy vibe with light knit." },

  { id:"cozy_cloudy", title:"Cozy × Cloudy", mood:"Cozy", weather:"Cloudy",
    hero:"assets_img/cozy_cloudy.jpg",
    palette_text:"Warm knit tones",
    items:["Knit sweater","Coat"],
    accessories:["Scarf","Warm bag"],
    description:"Comfort-focused winter-like cozy look." },

  { id:"cozy_rainy", title:"Cozy × Rainy", mood:"Cozy", weather:"Rainy",
    hero:"assets_img/cozy_rainy.jpg",
    palette_text:"Dark cozy palette",
    items:["Hood coat","Dark jeans"],
    accessories:["Boots","Umbrella"],
    description:"Warm + waterproof = perfect cozy rain outfit." },

  { id:"street_sunny", title:"Street × Sunny", mood:"Street", weather:"Sunny",
    hero:"assets_img/street_sunny.jpg",
    palette_text:"Purple / Brown / Green",
    items:["Graphic tee","Cargo shorts"],
    accessories:["Cap","Chain"],
    description:"Cool tones for a sunny street style." },

  { id:"street_cloudy", title:"Street × Cloudy", mood:"Street", weather:"Cloudy",
    hero:"assets_img/street_cloudy.jpg",
    palette_text:"Muted street tone",
    items:["Oversized hoodie","Wide pants"],
    accessories:["Chunky sneakers","Bag"],
    description:"Large fit to stand out in gray weather." },

  { id:"street_rainy", title:"Street × Rainy", mood:"Street", weather:"Rainy",
    hero:"assets_img/street_rainy.jpg",
    palette_text:"Techwear mix",
    items:["Rain jacket","Cargo pants"],
    accessories:["Bucket hat","Grip sneakers"],
    description:"Tech-inspired street rain outfit." }
];


/************************************************************
 * 17) HERO PAGE → MAIN PAGE (fade transition)
 ************************************************************/
document.getElementById("heroStart").addEventListener("click", () => {
  const hero = document.getElementById("hero");
  const mainPage = document.getElementById("mainPage");
  const pred = document.getElementById("pred-section");

  hero.classList.add("hiddenPage");

  setTimeout(() => {
    mainPage.classList.remove("hiddenPage");
    mainPage.classList.add("showPage");
    pred.classList.add("show");
    pred.scrollIntoView({ behavior: "smooth" });
  }, 300);
});


/************************************************************
 * 18) NETWORK STATUS
 ************************************************************/
function updateOnline() {
  if (navigator.onLine) setOk("Online — model can run.");
  else setError("Offline — first model load requires internet.");
}

window.addEventListener("online", updateOnline);
window.addEventListener("offline", updateOnline);


/************************************************************
 * 19) INIT
 ************************************************************/
(async () => {
  updateOnline();
  await loadModel();
})();
