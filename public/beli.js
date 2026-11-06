/* Halaman beli key. Tanpa inline script (aman untuk CSP). Semua teks pengguna dipasang lewat textContent. */
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var STATES = ["stForm", "stDetails", "stPay", "stDiscordPay", "stWait", "stDone", "stRenewed", "stEnd"];
  var LS = "gs-order";
  var cur = null;        // { id, token }
  var order = null;      // data pesanan terakhir dari server
  var poll = null, tick = null, packages = [], chosen = "autostore";
  var tsKey = null, tsId = null, tsToken = ""; // Cloudflare Turnstile (hanya kalau diaktifkan penjual)
  let discordInvite = "", dlQuote = null, loadingQuote = null, methodUpdate = 0;
  const selectedMethod = () => document.querySelector('input[name="paymentMethod"]:checked').value;

  function rp(n) { return "Rp" + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, "."); }
  const CHECKOUT_STEPS = { stForm: 0, stDetails: 1, stPay: 2, stDiscordPay: 2, stWait: 2, stDone: 3, stRenewed: 3 };
  function show(id, moveFocus = false) {
    STATES.forEach(s => $(s).classList.toggle("hide", s !== id));
    [...$("checkoutProgress").children].forEach((step, index) => {
      if (CHECKOUT_STEPS[id] === index) step.setAttribute("aria-current", "step");
      else step.removeAttribute("aria-current");
    });
    if (moveFocus) $(id).querySelector("h2").focus();
    window.scrollTo(0, 0);
  }
  function msg(id, t) { var e = $(id); e.textContent = t || ""; e.className = "msg err"; e.style.display = t ? "block" : "none"; }
  function lsGet() { try { return JSON.parse(localStorage.getItem(LS) || "null"); } catch (e) { return null; } }
  function lsSet(v) { try { if (v) localStorage.setItem(LS, JSON.stringify(v)); else localStorage.removeItem(LS); } catch (e) {} }
  function stop() { clearInterval(poll); clearInterval(tick); poll = tick = null; }

  async function api(method, url, body, token) {
    var h = { "Content-Type": "application/json" };
    if (token) h["X-Order-Token"] = token;
    var r = await fetch(url, { method: method, headers: h, body: body ? JSON.stringify(body) : undefined });
    var j = await r.json().catch(function () { return {}; });
    if (!r.ok) { var e = new Error(gsT(j.error || "Terjadi kesalahan. Coba lagi.")); e.status = r.status; throw e; }
    return j;
  }

  async function copy(text, btn, label) {
    try { await navigator.clipboard.writeText(text); btn.textContent = gsT("Tersalin ✓"); } catch (e) { btn.textContent = gsT("Gagal, salin manual"); }
    setTimeout(function () { btn.textContent = label; }, 1600);
  }

  function fmtTimer(ms) { if (ms < 0) ms = 0; var s = Math.floor(ms / 1000); return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0"); }

  function render(o) {
    order = o; stop();
    if (o.status === "pending" && o.paymentMethod === "dl") {
      $("dlAmount").textContent = gsFormatWL(o.amountWL);
      $("dlCode").textContent = o.code;
      $("dlInvite").href = discordInvite;
      const update = () => { $("dlTimer").textContent = fmtTimer(o.expiresAt - Date.now()); };
      update(); tick = setInterval(update, 1000); poll = setInterval(refresh, 5000);
      show("stDiscordPay", true);
    } else if (o.status === "pending") {
      $("payAmount").textContent = rp(o.amount); $("payAmount2").textContent = rp(o.amount); $("payCode").textContent = o.code + (o.renew ? gsT(" (perpanjangan)") : "");
      payMode(o);
      var upd = function () { var left = o.expiresAt - Date.now(); $("payTimer").textContent = fmtTimer(left); if (left <= 0) refresh(); };
      upd(); tick = setInterval(upd, 1000); poll = setInterval(refresh, o.auto ? 4000 : 10000);
      show("stPay", true);
    } else if (o.status === "claimed") {
      $("waitCode").textContent = o.code; $("waitAmount").textContent = rp(o.amount);
      poll = setInterval(refresh, 6000); show("stWait");
    } else if (o.status === "done") {
      if (o.renew) {
        $("renewText").textContent = o.renewedUntil
          ? gsT("Masa aktif key kamu sudah diperpanjang ") + o.days + gsT(" hari, sekarang berlaku sampai ") + new Date(o.renewedUntil).toLocaleString(gsLocale, { dateStyle: "long", timeStyle: "short" }) + gsT(". Tidak ada key baru, pakai key yang sama.")
          : gsT("Masa aktif key kamu sudah diperpanjang ") + o.days + gsT(" hari. Pakai key yang sama.");
        show("stRenewed");
      } else if (o.key) {
        $("keyBox").textContent = o.key;
        $("keyUntil").textContent = gsT("Key ini tampil di halaman ini sampai ") + new Date(o.keyUntil).toLocaleString(gsLocale, { dateStyle: "medium", timeStyle: "short" }) + gsT(". Salin sekarang.");
        show("stDone");
      } else {
        end(gsT("Key sudah tidak ditampilkan"), gsT("Demi keamanan key hanya tampil 24 jam. Kalau kamu belum sempat menyimpannya, hubungi penjual dan sebutkan kode pesanan ") + o.code + ".");
      }
    } else if (o.status === "rejected") {
      end(gsT("Pesanan tidak dilanjutkan"), gsT("Pembayaranmu belum bisa diverifikasi. Kalau kamu sudah membayar, hubungi penjual dan sebutkan kode pesanan ") + o.code + ".");
    } else {
      end(gsT("Pesanan kedaluwarsa"), gsT("Batas waktu pembayaran sudah lewat. Kalau kamu sudah terlanjur membayar, hubungi penjual dan sebutkan kode pesanan ") + o.code + gsT(". Kalau belum, buat pesanan baru."));
    }
  }
  // Pesanan QRIS otomatis memakai QR dinamis dengan nominal tepat dan terdeteksi sendiri; manual memakai QRIS statis + tombol "Saya sudah bayar".
  function payMode(o) {
    const auto = !!o.auto;
    const simulation = !!o.qrisSimulation;
    const image = $("qrImg");
    const download = $("qrDl");
    image.parentElement.classList.toggle("hide", simulation);
    download.parentElement.classList.toggle("hide", simulation);
    $("paySteps").classList.toggle("hide", simulation);
    $("btnCopyAmt").classList.toggle("hide", simulation);
    $("btnPaid").classList.toggle("hide", auto);
    $("payStep3").classList.toggle("hide", auto);
    $("payAuto").classList.toggle("hide", !auto || simulation);
    msg("payMsg", "");
    if (simulation) {
      image.removeAttribute("src");
      $("payWarn").textContent = gsT("Mode simulasi QRIS. Pesanan ini hanya bisa diselesaikan lewat Simulasi bayar di panel admin.");
      return;
    }
    const source = auto ? (o.qrPng || o.qrImageUrl) : "/qris.png";
    const imageFailed = () => {
      image.classList.add("hide");
      download.classList.add("hide");
      msg("payMsg", gsT("Gambar QRIS belum bisa dimuat. Muat ulang halaman untuk mencoba lagi."));
    };
    image.onerror = auto ? imageFailed : null;
    image.classList.remove("hide");
    download.classList.remove("hide");
    if (source) {
      image.src = source;
      download.href = source;
    } else imageFailed();
    $("payWarn").textContent = auto ? gsT("Bayar sesuai nominal di atas. Pembayaran dikenali otomatis.") : gsT("Nominal harus persis sama (termasuk 3 angka terakhir) supaya pembayaranmu dikenali.");
  }
  function end(title, text) { stop(); $("endTitle").textContent = title; $("endText").textContent = text; show("stEnd"); }

  async function refresh() {
    if (!cur) return;
    try { var r = await api("GET", "/api/orders/" + encodeURIComponent(cur.id), null, cur.token); if (!order || r.order.status !== order.status || r.order.key !== order.key) render(r.order); else order = r.order; }
    catch (e) { if (e.status === 404) { reset(); } }
  }

  function reset() { stop(); cur = null; order = null; lsSet(null); history.replaceState(null, "", location.pathname); show("stForm"); loadDLQuote().catch(() => {}); }

  function loadDLQuote() {
    if (dlQuote?.expiresAt > Date.now()) return Promise.resolve(dlQuote);
    if (!loadingQuote) {
      const updateCards = (quote, fallback) => {
        document.querySelectorAll("[data-dl-price]").forEach(line => {
          line.textContent = quote ? gsT("Estimasi: {0}", gsConvertDL(Number(line.dataset.dlPrice), quote)) : gsT(fallback);
        });
      };
      updateCards(null, "Memuat kurs DL…");
      loadingQuote = gsFetchDLRate().then(quote => {
        dlQuote = quote;
        updateCards(quote);
        return quote;
      }).catch(error => {
        dlQuote = null;
        updateCards(null, "Kurs DL belum tersedia");
        throw error;
      }).finally(() => { loadingQuote = null; });
    }
    return loadingQuote;
  }

  function renderPkgs() {
    var box = $("pkgs"); box.replaceChildren();
    packages.forEach(function (p) {
      var lab = document.createElement("label"); lab.className = "buy-pkg";
      var inp = document.createElement("input"); inp.type = "radio"; inp.name = "pkg"; inp.value = p.id; inp.checked = p.id === chosen;
      inp.addEventListener("change", function () { chosen = p.id; });
      var body = document.createElement("span"); body.className = "buy-pkg-body";
      var b = document.createElement("b"); b.textContent = p.name;
      const description = document.createElement("span");
      description.className = "plan-description";
      const descriptions = {
        autostore: "Mulai dan kelola toko Discord selama 30 hari.",
        autostore90: "Tiga bulan akses panel untuk toko yang sedang berkembang.",
        autostore365: "Setahun akses panel dengan satu pembayaran.",
        autostoreLifetime: "Akses lisensi tanpa masa kedaluwarsa.",
      };
      description.textContent = gsT(descriptions[p.id] || "Akses panel GevraStore.");
      var s = document.createElement("small"); s.textContent = gsPlanPeriod(p);
      var price = document.createElement("span"); price.className = "buy-price"; price.textContent = rp(p.price);
      const priceRow = document.createElement("span");
      priceRow.className = "plan-price-row";
      priceRow.append(price, s);
      const dlPrice = document.createElement("span");
      dlPrice.className = "plan-dl-price";
      dlPrice.dataset.dlPrice = p.price;
      dlPrice.textContent = gsT("Memuat kurs DL…");
      if (p.id === "autostore365") {
        lab.classList.add("plan-featured");
        const badge = document.createElement("span");
        badge.className = "plan-badge";
        badge.textContent = gsT("Paling hemat");
        body.append(badge);
      }
      const features = document.createElement("span");
      features.className = "plan-features";
      for (const name of ["Gratis hosting bot 24/7 di server cloud GevraStore", "Dashboard pengelolaan toko", "Katalog, stok, dan diskon", "Riwayat pesanan dan saldo", "Kustomisasi bot milikmu", "Gratis script deposit anti fake donate dengan dukungan Vend"]) {
        const line = document.createElement("span");
        line.textContent = gsT(name);
        features.append(line);
      }
      body.append(b, description, priceRow, dlPrice, features);
      lab.append(inp, body); box.appendChild(lab);
    });
  }

  function setupTurnstile(key) {
    tsKey = key; var box = $("tsBox"); box.classList.remove("hide");
    var sc = document.createElement("script"); sc.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"; sc.async = true;
    sc.onload = function () {
      if (!window.turnstile) return;
      tsId = window.turnstile.render(box, { sitekey: key, theme: "dark",
        callback: function (t) { tsToken = t; }, "expired-callback": function () { tsToken = ""; }, "error-callback": function () { tsToken = ""; } });
    };
    sc.onerror = function () { msg("formMsg", gsT("Verifikasi keamanan gagal dimuat. Muat ulang halaman.")); };
    document.head.appendChild(sc);
  }
  function resetTurnstile() { tsToken = ""; try { if (window.turnstile && tsId !== null) window.turnstile.reset(tsId); } catch (e) {} }

  async function updateMethod() {
    const update = ++methodUpdate;
    const paymentMethod = selectedMethod();
    const selected = packages.find(p => p.id === chosen);
    if (!selected) return;
    $("chosenPrice").textContent = rp(selected.price);
    $("btnOrder").disabled = paymentMethod === "dl";
    $("btnRetryDL").classList.add("hide");
    $("methodNote").textContent = gsT(paymentMethod === "dl" ? "Memuat kurs DL…" : "Pembayaran QRIS terdeteksi otomatis.");
    if (paymentMethod !== "dl") return;
    try {
      const quote = await loadDLQuote();
      if (update !== methodUpdate) return;
      $("chosenPrice").textContent = gsConvertDL(selected.price, quote);
      $("methodNote").textContent = gsT("Kurs 1 DL = {0}. Lanjutkan pembayaran di Discord.", rp(quote.pricePerDL));
      $("btnOrder").disabled = false;
    } catch (error) {
      if (update !== methodUpdate) return;
      $("methodNote").textContent = gsT("Kurs DL belum tersedia. Coba lagi atau pilih QRIS.");
      $("btnRetryDL").classList.remove("hide");
    }
  }
  $("btnRetryDL").addEventListener("click", updateMethod);
  document.querySelectorAll('input[name="paymentMethod"]').forEach(input => input.addEventListener("change", updateMethod));
  $("btnDetails").addEventListener("click", () => {
    const selected = packages.find(p => p.id === chosen);
    if (!selected) return;
    $("chosenPackage").textContent = selected.name;
    $("chosenDuration").textContent = selected.lifetime ? gsT("Seumur hidup") : gsPlanPeriod(selected).replace(/^\/\s*/, "");
    show("stDetails", true);
    updateMethod();
  });
  $("btnPackages").addEventListener("click", () => {
    show("stForm");
    $("pkgs").querySelector("input:checked")?.focus();
  });
  $("checkoutDetails").addEventListener("submit", async function (event) {
    event.preventDefault();
    var b = $("btnOrder");
    if (b.disabled) return;
    msg("formMsg", "");
    if (tsKey && !tsToken) { msg("formMsg", gsT("Selesaikan verifikasi keamanan dulu.")); return; }
    const method = selectedMethod();
    const discordTab = method === "dl" ? window.open("about:blank", "_blank") : null;
    if (discordTab) discordTab.opener = null;
    b.disabled = $("btnPackages").disabled = true;
    const methodInputs = [...document.querySelectorAll('input[name="paymentMethod"]')];
    methodInputs.forEach(input => { input.disabled = true; });
    var old = b.textContent; b.textContent = gsT("Memproses...");
    try {
      var r = await api("POST", "/api/orders", { type: chosen, paymentMethod: method, pricePerDL: method === "dl" ? dlQuote?.pricePerDL : undefined, turnstileToken: tsToken });
      cur = { id: r.order.id, token: r.token }; lsSet(cur); history.replaceState(null, "", "#" + cur.id + "." + cur.token); render(r.order);
      if (discordTab && !discordTab.closed && discordInvite) discordTab.location.replace(discordInvite);
      else discordTab?.close();
    } catch (e) {
      discordTab?.close();
      msg("formMsg", e.message);
      if (method === "dl") dlQuote = null;
    }
    if (tsKey) resetTurnstile(); /* token Turnstile hanya berlaku sekali */
    methodInputs.forEach(input => { input.disabled = false; });
    b.disabled = $("btnPackages").disabled = false; b.textContent = old;
    if (!cur && method === "dl") updateMethod();
  });
  $("btnPaid").addEventListener("click", async function () {
    var b = $("btnPaid"); msg("payMsg", ""); b.disabled = true; var old = b.textContent; b.textContent = gsT("Memproses...");
    try { var r = await api("POST", "/api/orders/" + encodeURIComponent(cur.id) + "/paid", {}, cur.token); render(r.order); }
    catch (e) { msg("payMsg", e.message); if (e.status === 409) refresh(); }
    b.disabled = false; b.textContent = old;
  });
  $("btnCancel").addEventListener("click", async function () { if (await gsConfirm(gsT("Batalkan pesanan ini? Kalau sudah terlanjur membayar, jangan dibatalkan."), { danger: true, okText: gsT("Ya, batalkan"), cancelText: gsT("Kembali") })) reset(); });
  $("btnNew").addEventListener("click", reset);
  $("btnDlBack").addEventListener("click", reset);
  $("btnCopyDlCode").addEventListener("click", () => { if (order) copy(order.code, $("btnCopyDlCode"), gsT("Salin kode pesanan")); });
  $("btnCopyAmt").addEventListener("click", function () { if (order) copy(String(order.amount), $("btnCopyAmt"), gsT("Salin nominal")); });
  $("btnCopyKey").addEventListener("click", function () { copy($("keyBox").textContent, $("btnCopyKey"), gsT("Salin key")); });
  $("btnCopyLink").addEventListener("click", function () { copy(location.href, $("btnCopyLink"), gsT("Salin link pesanan")); });

  (async function init() {
    try { var info = await api("GET", "/api/shop-info"); packages = info.packages; discordInvite = info.discordInvite || ""; const requested = new URLSearchParams(location.search).get("paket"); chosen = (packages.find(p => p.id === requested) || packages[0])?.id; if (info.turnstileSiteKey) setupTurnstile(info.turnstileSiteKey); } catch (e) { msg("pkgMsg", gsT("Gagal memuat daftar paket. Muat ulang halaman.")); }
    renderPkgs();
    if (packages.length) loadDLQuote().catch(() => {});
    $("pkgs").setAttribute("aria-busy", "false");
    $("btnDetails").disabled = !packages.length;
    if (!packages.length && !$("pkgMsg").textContent) msg("pkgMsg", gsT("Belum ada paket yang tersedia."));
    var m = /^#([0-9a-f]{12})\.([0-9a-f]{48})$/.exec(location.hash), saved = lsGet();
    cur = m ? { id: m[1], token: m[2] } : (saved && saved.id && saved.token ? saved : null);
    if (cur) {
      try { var r = await api("GET", "/api/orders/" + encodeURIComponent(cur.id), null, cur.token); lsSet(cur); history.replaceState(null, "", "#" + cur.id + "." + cur.token); render(r.order); return; }
      catch (e) { cur = null; lsSet(null); }
    }
    show("stForm");
  })();
})();
