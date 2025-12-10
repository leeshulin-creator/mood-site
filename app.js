
// 🔊 SIMPLE TTS FUNCTION
// 🔊 SIMPLE TTS FUNCTION
function speak(text) {
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = "en-US";   // 영어 음성
  utter.rate = 1.1;       // 약간 빠르게
  utter.pitch = 1;        // 기본 피치
  speechSynthesis.speak(utter);
}

// 🔊 사운드 허용 여부
let soundEnabled = false;

function playSoftBeep() {
  if (!soundEnabled) return;   // 아직 사운드 허용 안 되었으면 재생 안 함
  const audio = new Audio("assets_audio/beep_soft.mp3");
  audio.volume = 0.4;
  audio.play();
}

function playAlertBeep() {
  if (!soundEnabled) return;
  const audio = new Audio("assets_audio/beep_alert.mp3");
  audio.volume = 0.4;
  audio.play();
}



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

// 🔓 사용자 클릭으로 오디오 언락
function unlockAudio() {
  if (soundEnabled) return; // 이미 허용된 경우 재시도 안 함

  const test = new Audio("assets_audio/beep_soft.mp3");
  test.volume = 0.01;
  test.play()
    .then(() => {
      console.log("Audio unlocked");
      soundEnabled = true;
    })
    .catch(err => {
      console.log("Audio unlock failed", err);
    });
}

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

$btnNextWeather.addEventListener("click", () => {
  unlockAudio();      // 👈 먼저 오디오 권한 언락
  gotoWeatherStep();  // 👈 그다음 날씨 단계로 이동
});



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
  if (!data.current) throw new Error("Invalid air quality API response (no current)");

  const c = data.current;

  // pm10/pm2_5 값이 배열이거나 숫자거나 둘 다 처리
  let pm10 = Array.isArray(c.pm10) ? c.pm10[0] : c.pm10;
  let pm25 = Array.isArray(c.pm2_5) ? c.pm2_5[0] : c.pm2_5;

  if (typeof pm10 !== "number" || typeof pm25 !== "number") {
    throw new Error("Invalid air quality values");
  }

  return { pm10, pm2_5: pm25 };
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

        const [weather, dust] = await Promise.all([
          fetchWeatherByLatLon(lat, lon),
          fetchDustByLatLon(lat, lon)
        ]);

        const w = mapCodeToWeatherText(weather.code);
        selectedWeather = w;

        const pm10 = Math.round(dust.pm10);
        const pm25 = Math.round(dust.pm2_5);

        const g10 = gradePm10(pm10);
        const g25 = gradePm25(pm25);

        const overallLevel = Math.max(g10.level, g25.level);
        const maskMsg = maskMessageForLevel(overallLevel);

        // 🎤 Voice output
        const summary = `Today's weather is ${w}, and the temperature is ${weather.temp} degrees.`;
        let dustVoice = `Fine dust level is ${g25.label}. `;

        if (overallLevel === 2) {
          dustVoice += "A KF80 mask is recommended.";
        } else if (overallLevel === 3) {
          dustVoice += "The air quality is very unhealthy. Please wear a KF94 mask.";
        }

        speak(summary + " " + dustVoice);

        // 🔔 beep sound based on dust level
        if (overallLevel === 2) {
          playSoftBeep();
        } else if (overallLevel === 3) {
          playAlertBeep();
        }

        // 📝 Display
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
 * 16) RECOMMENDATION DATA  (여성 description 유지 + 남성 팔레트/아이템만 적용)
 ************************************************************/
const RECOMMENDATIONS = [

  /* -------------------- ACTIVE × SUNNY -------------------- */
  {
    id:"active_sunny",
    title:"Active × Sunny",
    mood:"Active",
    weather:"Sunny",
    hero:"assets_img/active_sunny.jpg",
    palette_text:"Red / Orange / Yellow",
    palette_text_male:"Red / Black / Brown",

    items:["Cotton T-shirt","Mini skirt","Sneakers"],
    items_male:["Hoodie","Bermuda shorts","Work boots"],

    accessories:["Sunglasses","Cap","Beaded bracelet"],
    accessories_male:["Bandana","Belt","Smartphone"],

    description:"Bright energy for sunny weather."
  },

  /* -------------------- ACTIVE × CLOUDY -------------------- */
  {
    id:"active_cloudy",
    title:"Active × Cloudy",
    mood:"Active",
    weather:"Cloudy",
    hero:"assets_img/active_cloudy.jpg",
    palette_text:"Red / Orange / Yellow (toned down)",
    palette_text_male:"Yellow / Navy / Denim Blue",

    items:["T-shirt + cardigan","Light pants"],
    items_male:["Hoodie","Denim jacket","Wide denim pants"],

    accessories:["Bucket hat","Crossbody bag"],
    accessories_male:["Glasses","Wrist watch","Sneakers"],

    description:"Stay light and energetic on cloudy days."
  },

  /* -------------------- ACTIVE × RAINY -------------------- */
  {
    id:"active_rainy",
    title:"Active × Rainy",
    mood:"Active",
    weather:"Rainy",
    hero:"assets_img/active_rainy.jpg",
    palette_text:"Bright inner + rain outer",
    palette_text_male:"Red / Light Blue / Yellow",

    items:["Rain jacket","Long pants"],
    items_male:["Hooded jacket","Denim pants","Sneakers"],

    accessories:["Umbrella","Backpack"],
    accessories_male:["Umbrella","Cross bag","Stud belt"],

    description:"Energy inside, protection outside."
  },

  /* -------------------- MINIMAL × SUNNY -------------------- */
  {
    id:"minimal_sunny",
    title:"Minimal × Sunny",
    mood:"Minimal",
    weather:"Sunny",
    hero:"assets_img/minimal_sunny.jpg",
    palette_text:"Beige / Light Blue / White",
    palette_text_male:"Black / Dark Gray / Silver",

    items:["Light blue shirt","White pants"],
    items_male:["Leather jacket","Turtleneck top","Slacks"],

    accessories:["Leather tote","Metal watch"],
    accessories_male:["Tote bag","Sunglasses","Wrist watch"],

    description:"Clean bright minimal look."
  },

  /* -------------------- MINIMAL × CLOUDY -------------------- */
  {
    id:"minimal_cloudy",
    title:"Minimal × Cloudy",
    mood:"Minimal",
    weather:"Cloudy",
    hero:"assets_img/minimal_cloudy.jpg",
    palette_text:"Soft beige & blue",
    palette_text_male:"Black / Gray / Light Blue",

    items:["Shirt + cardigan","Chinos"],
    items_male:["Long coat","Hoodie","Straight jeans"],

    accessories:["Slim belt","Minimal sneakers"],
    accessories_male:["Cap","Cross bag","Sneakers"],

    description:"Balanced tones for cloudy day stability."
  },

  /* -------------------- MINIMAL × RAINY -------------------- */
  {
    id:"minimal_rainy",
    title:"Minimal × Rainy",
    mood:"Minimal",
    weather:"Rainy",
    hero:"assets_img/minimal_rainy.jpg",
    palette_text:"Rain-friendly neutrals",
    palette_text_male:"Black / Dark Gray / Brown",

    items:["Beige trench","Shirt","Slacks"],
    items_male:["Knit top","Slacks","Sneakers"],

    accessories:["Tote bag","Watch"],
    accessories_male:["Umbrella","Leather shoulder bag","Minimal shoes"],

    description:"Keep it clean even in the rain."
  },

  /* -------------------- COZY × SUNNY -------------------- */
  {
    id:"cozy_sunny",
    title:"Cozy × Sunny",
    mood:"Cozy",
    weather:"Sunny",
    hero:"assets_img/cozy_sunny.jpg",
    palette_text:"Navy / Black / Gray",
    palette_text_male:"Blue / White / Light Gray",

    items:["Light knit","Relaxed pants"],
    items_male:["Check shirt","White T-shirt","Denim pants"],

    accessories:["Soft scarf","Canvas bag"],
    accessories_male:["Headphones","Sneakers","Minimal bracelet"],

    description:"Relaxed cozy vibe with light knit."
  },

  /* -------------------- COZY × CLOUDY -------------------- */
  {
    id:"cozy_cloudy",
    title:"Cozy × Cloudy",
    mood:"Cozy",
    weather:"Cloudy",
    hero:"assets_img/cozy_cloudy.jpg",
    palette_text:"Warm knit tones",
    palette_text_male:"Navy / Gray / Black",

    items:["Knit sweater","Coat"],
    items_male:["Wool coat","Hoodie","Slacks"],

    accessories:["Scarf","Warm bag"],
    accessories_male:["Knit beanie","Loafers","Winter cap"],

    description:"Comfort-focused winter-like cozy look."
  },

  /* -------------------- COZY × RAINY -------------------- */
  {
    id:"cozy_rainy",
    title:"Cozy × Rainy",
    mood:"Cozy",
    weather:"Rainy",
    hero:"assets_img/cozy_rainy.jpg",
    palette_text:"Dark cozy palette",
    palette_text_male:"Navy / Black / Brown",

    items:["Hood coat","Dark jeans"],
    items_male:["Windbreaker jacket","Slacks","Loafers"],

    accessories:["Boots","Umbrella"],
    accessories_male:["Umbrella","Leather belt","Dress shoes"],

    description:"Warm + waterproof = perfect cozy rain outfit."
  },

  /* -------------------- STREET × SUNNY -------------------- */
  {
    id:"street_sunny",
    title:"Street × Sunny",
    mood:"Street",
    weather:"Sunny",
    hero:"assets_img/street_sunny.jpg",
    palette_text:"Purple / Brown / Green",
    palette_text_male:"Olive / Brown / Black",

    items:["Graphic tee","Cargo shorts"],
    items_male:["Long-sleeve T-shirt","Cargo pants","Loafers"],

    accessories:["Cap","Chain"],
    accessories_male:["Backpack","Chain necklace","Headphones"],

    description:"Cool tones for a sunny street style."
  },

  /* -------------------- STREET × CLOUDY -------------------- */
  {
    id:"street_cloudy",
    title:"Street × Cloudy",
    mood:"Street",
    weather:"Cloudy",
    hero:"assets_img/street_cloudy.jpg",
    palette_text:"Muted street tone",
    palette_text_male:"Khaki / Brown / Dark Green",

    items:["Oversized hoodie","Wide pants"],
    items_male:["Leather jacket","Cargo pants","Work boots"],

    accessories:["Chunky sneakers","Bag"],
    accessories_male:["Cross bag","Baseball cap","Glasses"],

    description:"Large fit to stand out in gray weather."
  },

  /* -------------------- STREET × RAINY -------------------- */
  {
    id:"street_rainy",
    title:"Street × Rainy",
    mood:"Street",
    weather:"Rainy",
    hero:"assets_img/street_rainy.jpg",
    palette_text:"Techwear mix",
    palette_text_male:"Olive / Gray / Black",

    items:["Rain jacket","Cargo pants"],
    items_male:["Waterproof parka","Wide pants","Sneakers"],

    accessories:["Bucket hat","Grip sneakers"],
    accessories_male:["Umbrella","Cross bag","Baseball cap"],

    description:"Tech-inspired street rain outfit."
  }

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
