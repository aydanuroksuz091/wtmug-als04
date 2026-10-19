/* =========================================================
   MARKETİM PWA — Barkod Okuyucu (Flaş Destekli)
   ========================================================= */
const CACHE_NAME = "marketim-v9";
const state = {
  products: [],
  cart: [],          // { barcode, name, price, qty }
  lastScanned: null,
  singleReader: null,
  bulkReader: null,
  scanning: false,
  currentStream: null, // Flaş kontrolü için kamerayı tutacağız
};

// ---------- Yardımcılar ----------
const $ = (sel) => document.querySelector(sel);
const fmt = (n) => n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " ₺";

// ---------- Ürün verisini yükle ----------
async function loadProducts() {
  try {
    const res = await fetch("products.json", { cache: "no-cache" });
    const data = await res.json();
    state.products = data.products || [];
    console.log(`✅ ${state.products.length} ürün yüklendi`);
  } catch (err) {
    console.error("Ürünler yüklenemedi:", err);
    alert("Ürün veritabanı yüklenemedi.");
  }
}

function findProduct(barcode) {
  return state.products.find((p) => p.barcode === barcode);
}

// ---------- Sekme Yönetimi ----------
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach((c) => c.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById(`tab-${tab.dataset.tab}`).classList.add("active");
    
    // Sekme değişince kameraları kapat (Sepet sekmesine geçince kamera açık kalmasın)
    stopAllScanning(); 
  });
});

// ---------- FLAŞ KONTROLÜ ----------
function toggleFlash(btnElement, videoElement) {
  if (!state.currentStream) return;
  
  const track = state.currentStream.getVideoTracks()[0];
  if (!track) return;

  const capabilities = track.getCapabilities ? track.getCapabilities() : {};
  
  if (!capabilities.torch) {
    alert("Cihazınız flaş kontrolünü desteklemiyor.");
    return;
  }

  const isFlashOn = btnElement.classList.contains("active");
  
  track.applyConstraints({
    advanced: [{ torch: !isFlashOn }]
  }).then(() => {
    btnElement.classList.toggle("active");
  }).catch((err) => {
    console.error("Flaş hatası:", err);
  });
}

// ---------- ZXing ile Kamera Başlat ----------
async function startScanner(videoEl, flashBtn, onResult) {
  const codeReader = new ZXing.BrowserMultiFormatReader();
  let stream = null;
  let stopped = false;

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const backCam = devices.find((d) => d.kind === "videoinput" && /back|rear|environment/i.test(d.label));
    const deviceId = backCam?.deviceId;

    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    });

    state.currentStream = stream; // Flaş için kaydet
    videoEl.srcObject = stream;
    await videoEl.play();

    // Flaş butonunu göster (eğer cihaz destekliyorsa)
    const track = stream.getVideoTracks()[0];
    const caps = track.getCapabilities ? track.getCapabilities() : {};
    if (caps.torch) {
      flashBtn.classList.remove("hidden");
      flashBtn.onclick = () => toggleFlash(flashBtn, videoEl);
    }

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    const tick = async () => {
      if (stopped || videoEl.readyState < 2) {
        if (!stopped) requestAnimationFrame(tick);
        return;
      }
      canvas.width = videoEl.videoWidth;
      canvas.height = videoEl.videoHeight;
      ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);

      try {
        const hints = new Map();
        hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
        const luminance = new ZXing.HTMLCanvasElementLuminanceSource(canvas);
        const bitmap = new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(luminance));
        const reader = new ZXing.MultiFormatReader();
        reader.setHints(hints);
        const result = reader.decode(bitmap);
        if (result && result.getText()) {
          const text = result.getText();
          if (text !== state.lastScanned) {
            state.lastScanned = text;
            onResult(text);
            setTimeout(() => (state.lastScanned = null), 1500);
          }
        }
      } catch (e) { /* Barkod bulunamadı */ }
      if (!stopped) requestAnimationFrame(tick);
    };
    tick();

    return {
      stop: () => {
        stopped = true;
        if (stream) stream.getTracks().forEach((t) => t.stop());
        videoEl.srcObject = null;
        flashBtn.classList.add("hidden");
        flashBtn.classList.remove("active");
        state.currentStream = null;
      },
    };
  } catch (err) {
    alert("Kamera açılamadı: " + err.message);
    if (stream) stream.getTracks().forEach((t) => t.stop());
    return { stop: () => {} };
  }
}

// ---------- TEKLİ OKUMA ----------
async function startSingleScan() {
  $("#start-single").classList.add("hidden");
  $("#stop-single").classList.remove("hidden");
  $("#product-info").classList.add("hidden");
  $("#not-found").classList.add("hidden");

  state.singleReader = await startScanner($("#video-single"), $("#flash-single"), onSingleResult);
}

function onSingleResult(barcode) {
  if (navigator.vibrate) navigator.vibrate(120);

  const product = findProduct(barcode);
  if (product) {
    state.lastProduct = product;
    $("#pi-barcode").textContent  = product.barcode;
    $("#pi-name").textContent     = product.name;
    $("#pi-brand").textContent    = product.brand;
    $("#pi-category").textContent = product.category;
    $("#pi-quantity").textContent = product.quantity;
    $("#pi-price").textContent    = fmt(product.price);
    $("#product-info").classList.remove("hidden");
    $("#not-found").classList.add("hidden");
    
    // Sepete Ekle butonunu göster, Sepete Git'i gizle (yeni ürün okutulduğunda)
    $("#add-to-cart").classList.remove("hidden");
    $("#go-to-cart").classList.add("hidden");
    
    stopSingleScan();
  } else {
    $("#not-found").classList.remove("hidden");
    $("#product-info").classList.add("hidden");
  }
}

function stopSingleScan() {
  if (state.singleReader) { state.singleReader.stop(); state.singleReader = null; }
  $("#start-single").classList.remove("hidden");
  $("#stop-single").classList.add("hidden");
}

// Sepete ekle ve "Sepete Git" butonunu göster
$("#add-to-cart").addEventListener("click", () => {
  const p = state.lastProduct;
  if (!p) return;
  addToCart(p);
  alert(`✅ "${p.name}" sepete eklendi.`);
  
  // Eklenince sepete git butonu çıksın
  $("#add-to-cart").classList.add("hidden");
  $("#go-to-cart").classList.remove("hidden");
});

// Sepete Git butonuna basınca sekmeyi değiştir
$("#go-to-cart").addEventListener("click", () => {
  document.querySelector('[data-tab="cart"]').click();
});

// ---------- TOPLU OKUMA ----------
async function startBulkScan() {
  $("#start-bulk").classList.add("hidden");
  $("#stop-bulk").classList.remove("hidden");
  state.bulkReader = await startScanner($("#video-bulk"), $("#flash-bulk"), onBulkResult);
}

function onBulkResult(barcode) {
  if (navigator.vibrate) navigator.vibrate(80);
  const product = findProduct(barcode);
  const box = $("#video-bulk").parentElement;
  
  if (product) {
    addToCart(product);
    box.style.boxShadow = "0 0 0 4px #198754";
    setTimeout(() => (box.style.boxShadow = ""), 300);
  } else {
    box.style.boxShadow = "0 0 0 4px #c62828";
    setTimeout(() => (box.style.boxShadow = ""), 300);
  }
}

function stopBulkScan() {
  if (state.bulkReader) { state.bulkReader.stop(); state.bulkReader = null; }
  $("#start-bulk").classList.remove("hidden");
  $("#stop-bulk").classList.add("hidden");
}

function stopAllScanning() {
  stopSingleScan();
  stopBulkScan();
}

// ---------- SEPET ----------
function addToCart(product) {
  const existing = state.cart.find((i) => i.barcode === product.barcode);
  if (existing) {
    existing.qty += 1;
  } else {
    state.cart.push({
      barcode: product.barcode,
      name: product.name,
      price: product.price,
      qty: 1,
    });
  }
  renderCart();
}

function renderCart() {
  const list = $("#cart-list");
  list.innerHTML = "";
  if (state.cart.length === 0) {
    list.innerHTML = '<li class="empty">Sepet boş</li>';
    $("#cart-total").textContent = fmt(0);
    return;
  }
  let total = 0;
  state.cart.forEach((item) => {
    const lineTotal = item.price * item.qty;
    total += lineTotal;
    const li = document.createElement("li");
    li.innerHTML = `<span>${item.name} × ${item.qty}</span><b>${fmt(lineTotal)}</b>`;
    list.appendChild(li);
  });
  $("#cart-total").textContent = fmt(total);
}

$("#clear-cart").addEventListener("click", () => {
  if (state.cart.length && confirm("Sepet temizlensin mi?")) {
    state.cart = [];
    renderCart();
  }
});

$("#checkout").addEventListener("click", () => {
  if (state.cart.length === 0) {
    alert("Sepet boş!");
    return;
  }
  const total = state.cart.reduce((s, i) => s + i.price * i.qty, 0);
  alert(`💳 Ödeme ekranına yönlendiriliyorsunuz...\n\nToplam: ${fmt(total)}\nÜrün çeşidi: ${state.cart.length}`);
});

// ---------- Butonlar ----------
$("#start-single").addEventListener("click", startSingleScan);
$("#stop-single").addEventListener("click", stopSingleScan);
$("#start-bulk").addEventListener("click", startBulkScan);
$("#stop-bulk").addEventListener("click", stopBulkScan);

// ---------- Service Worker ----------
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch((err) => console.warn("SW hatası:", err));
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  await loadProductNames(); // Fonksiyon adını düzelttim
  renderCart();
});

async function loadProductNames() {
  await loadProducts();
}
