/* Halaman beli key. Tanpa inline script (aman untuk CSP). Semua teks pengguna dipasang lewat textContent. */
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var STATES = ["stForm", "stPay", "stWait", "stDone", "stRenewed", "stEnd"];
  var LS = "gs-order";
  var cur = null;        // { id, token }
  var order = null;      // data pesanan terakhir dari server
  var poll = null, tick = null, packages = [], chosen = "autostore";
  var tsKey = null, tsId = null, tsToken = ""; // Cloudflare Turnstile (hanya kalau diaktifkan penjual)

  function rp(n) { return "Rp" + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, "."); }
  function show(id) { STATES.forEach(function (s) { $(s).classList.toggle("hide", s !== id); }); window.scrollTo({ top: 0, behavior: "smooth" }); }
  function msg(id, t) { var e = $(id); e.textContent = t || ""; e.className = "msg err"; e.style.display = t ? "block" : "none"; }
  function lsGet() { try { return JSON.parse(localStorage.getItem(LS) || "null"); } catch (e) { return null; } }
  function lsSet(v) { try { if (v) localStorage.setItem(LS, JSON.stringify(v)); else localStorage.removeItem(LS); } catch (e) {} }
  function stop() { clearInterval(poll); clearInterval(tick); poll = tick = null; }

  async function api(method, url, body, token) {
    var h = { "Content-Type": "application/json" };
    if (token) h["X-Order-Token"] = token;
    var r = await fetch(url, { method: method, headers: h, body: body ? JSON.stringify(body) : undefined });
    var j = await r.json().catch(function () { return {}; });
    if (!r.ok) { var e = new Error(j.error || "Terjadi kesalahan. Coba lagi."); e.status = r.status; throw e; }
    return j;
  }

  async function copy(text, btn, label) {
    try { await navigator.clipboard.writeText(text); btn.textContent = "Tersalin ✓"; } catch (e) { btn.textContent = "Gagal, salin manual"; }
    setTimeout(function () { btn.textContent = label; }, 1600);
  }

  function fmtTimer(ms) { if (ms < 0) ms = 0; var s = Math.floor(ms / 1000); return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0"); }

  function render(o) {
    order = o; stop();
    if (o.status === "pending") {
      $("payAmount").textContent = rp(o.amount); $("payAmount2").textContent = rp(o.amount); $("payCode").textContent = o.code + (o.renew ? " (perpanjangan)" : "");
      payMode(o);
      var upd = function () { var left = o.expiresAt - Date.now(); $("payTimer").textContent = fmtTimer(left); if (left <= 0) refresh(); };
      upd(); tick = setInterval(upd, 1000); poll = setInterval(refresh, o.auto ? 4000 : 10000);
      show("stPay");
    } else if (o.status === "claimed") {
      $("waitCode").textContent = o.code; $("waitAmount").textContent = rp(o.amount);
      poll = setInterval(refresh, 6000); show("stWait");
    } else if (o.status === "done") {
      if (o.renew) {
        $("renewText").textContent = o.renewedUntil
          ? "Masa aktif key kamu sudah diperpanjang " + o.days + " hari, sekarang berlaku sampai " + new Date(o.renewedUntil).toLocaleString("id-ID", { dateStyle: "long", timeStyle: "short" }) + ". Tidak ada key baru, pakai key yang sama."
          : "Masa aktif key kamu sudah diperpanjang " + o.days + " hari. Pakai key yang sama.";
        show("stRenewed");
      } else if (o.key) {
        $("keyBox").textContent = o.key;
        $("keyUntil").textContent = "Key ini tampil di halaman ini sampai " + new Date(o.keyUntil).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" }) + ". Salin sekarang.";
        show("stDone");
      } else {
        end("Key sudah tidak ditampilkan", "Demi keamanan key hanya tampil 24 jam. Kalau kamu belum sempat menyimpannya, hubungi penjual dan sebutkan kode pesanan " + o.code + ".");
      }
    } else if (o.status === "rejected") {
      end("Pesanan tidak dilanjutkan", "Pembayaranmu belum bisa diverifikasi. Kalau kamu sudah membayar, hubungi penjual dan sebutkan kode pesanan " + o.code + ".");
    } else {
      end("Pesanan kedaluwarsa", "Batas waktu pembayaran sudah lewat. Kalau kamu sudah terlanjur membayar, hubungi penjual dan sebutkan kode pesanan " + o.code + ". Kalau belum, buat pesanan baru.");
    }
  }
  // Pesanan QRIS otomatis memakai QR dinamis dengan nominal tepat dan terdeteksi sendiri; manual memakai QRIS statis + tombol "Saya sudah bayar".
  function payMode(o) {
    var auto = !!(o.auto && o.qrPng);
    $("qrImg").src = auto ? o.qrPng : "/qris.png";
    $("qrDl").href = auto ? o.qrPng : "/qris.png";
    $("btnPaid").classList.toggle("hide", auto);
    $("payStep3").classList.toggle("hide", auto);
    $("payAuto").classList.toggle("hide", !auto);
    $("payWarn").textContent = auto ? "Bayar sesuai nominal di atas. Pembayaran dikenali otomatis." : "Nominal harus persis sama (termasuk 3 angka terakhir) supaya pembayaranmu dikenali.";
  }
  function end(title, text) { stop(); $("endTitle").textContent = title; $("endText").textContent = text; show("stEnd"); }

  async function refresh() {
    if (!cur) return;
    try { var r = await api("GET", "/api/orders/" + encodeURIComponent(cur.id), null, cur.token); if (!order || r.order.status !== order.status || r.order.key !== order.key) render(r.order); else order = r.order; }
    catch (e) { if (e.status === 404) { reset(); } }
  }

  function reset() { stop(); cur = null; order = null; lsSet(null); history.replaceState(null, "", location.pathname); show("stForm"); }

  function renderPkgs() {
    var box = $("pkgs"); box.replaceChildren();
    packages.forEach(function (p) {
      var lab = document.createElement("label"); lab.className = "buy-pkg";
      var inp = document.createElement("input"); inp.type = "radio"; inp.name = "pkg"; inp.value = p.id; inp.checked = p.id === chosen;
      inp.addEventListener("change", function () { chosen = p.id; });
      var body = document.createElement("span"); body.className = "buy-pkg-body";
      var b = document.createElement("b"); b.textContent = p.name;
      var s = document.createElement("small"); s.textContent = p.days + " hari";
      body.append(b, s);
      var price = document.createElement("span"); price.className = "buy-price"; price.textContent = rp(p.price);
      lab.append(inp, body, price); box.appendChild(lab);
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
    sc.onerror = function () { msg("formMsg", "Verifikasi keamanan gagal dimuat. Muat ulang halaman."); };
    document.head.appendChild(sc);
  }
  function resetTurnstile() { tsToken = ""; try { if (window.turnstile && tsId !== null) window.turnstile.reset(tsId); } catch (e) {} }

  $("btnOrder").addEventListener("click", async function () {
    var b = $("btnOrder"); msg("formMsg", "");
    if (tsKey && !tsToken) { msg("formMsg", "Selesaikan verifikasi keamanan dulu."); return; }
    b.disabled = true; var old = b.textContent; b.textContent = "Memproses...";
    try {
      var r = await api("POST", "/api/orders", { type: chosen, name: $("fName").value, contact: $("fContact").value, turnstileToken: tsToken });
      cur = { id: r.order.id, token: r.token }; lsSet(cur); history.replaceState(null, "", "#" + cur.id + "." + cur.token); render(r.order);
    } catch (e) { msg("formMsg", e.message); }
    if (tsKey) resetTurnstile(); /* token Turnstile hanya berlaku sekali */
    b.disabled = false; b.textContent = old;
  });
  $("btnPaid").addEventListener("click", async function () {
    var b = $("btnPaid"); msg("payMsg", ""); b.disabled = true; var old = b.textContent; b.textContent = "Memproses...";
    try { var r = await api("POST", "/api/orders/" + encodeURIComponent(cur.id) + "/paid", {}, cur.token); render(r.order); }
    catch (e) { msg("payMsg", e.message); if (e.status === 409) refresh(); }
    b.disabled = false; b.textContent = old;
  });
  $("btnCancel").addEventListener("click", async function () { if (await gsConfirm("Batalkan pesanan ini? Kalau sudah terlanjur membayar, jangan dibatalkan.", { danger: true, okText: "Ya, batalkan", cancelText: "Kembali" })) reset(); });
  $("btnNew").addEventListener("click", reset);
  $("btnCopyAmt").addEventListener("click", function () { if (order) copy(String(order.amount), $("btnCopyAmt"), "Salin nominal"); });
  $("btnCopyKey").addEventListener("click", function () { copy($("keyBox").textContent, $("btnCopyKey"), "Salin key"); });
  $("btnCopyLink").addEventListener("click", function () { copy(location.href, $("btnCopyLink"), "Salin link pesanan"); });

  (async function init() {
    try { var info = await api("GET", "/api/shop-info"); packages = info.packages; if (packages.length) chosen = packages[0].id; if (info.turnstileSiteKey) setupTurnstile(info.turnstileSiteKey); } catch (e) { msg("formMsg", "Gagal memuat daftar paket. Muat ulang halaman."); }
    renderPkgs();
    var m = /^#([0-9a-f]{12})\.([0-9a-f]{48})$/.exec(location.hash), saved = lsGet();
    cur = m ? { id: m[1], token: m[2] } : (saved && saved.id && saved.token ? saved : null);
    if (cur) {
      try { var r = await api("GET", "/api/orders/" + encodeURIComponent(cur.id), null, cur.token); lsSet(cur); history.replaceState(null, "", "#" + cur.id + "." + cur.token); render(r.order); return; }
      catch (e) { cur = null; lsSet(null); }
    }
    show("stForm");
  })();
})();
