/* Tambahan halaman masuk: tombol mata, tombol "Memproses...", dan tautan bantuan.
   Tanpa inline script, jadi aman untuk CSP. */

/* >>> ISI DI SINI: link WhatsApp / Discord penjual. Contoh: "https://wa.me/628123456789"
   Kalau dikosongkan, tulisan "Hubungi penjual." tampil tanpa tautan. */
var CONTACT_URL = "";

(function () {
  var input = document.getElementById("key");
  var btnLogin = document.getElementById("btnLogin");
  var msg = document.getElementById("loginMsg");
  var loginBox = document.getElementById("login");
  if (!input) return;
  var ns = "http://www.w3.org/2000/svg";

  function icon(paths) {
    var svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    paths.forEach(function (d) {
      var p = document.createElementNS(ns, "path");
      p.setAttribute("d", d);
      svg.appendChild(p);
    });
    return svg;
  }

  /* 1. Tombol mata (tampilkan / sembunyikan key) */
  var EYE = ["M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z", "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"];
  var EYE_OFF = ["M3 3l18 18", "M10.6 6.1A9.9 9.9 0 0 1 12 6c6.4 0 10 6 10 6a17 17 0 0 1-3.2 3.9", "M6.6 7.6C3.8 9.4 2 12 2 12s3.6 6 10 6c1.5 0 2.8-.3 4-.8", "M9.9 9.9a3 3 0 0 0 4.2 4.2"];
  var eye = document.createElement("button");
  eye.type = "button";
  eye.className = "key-eye";
  eye.setAttribute("aria-label", "Tampilkan key");
  eye.appendChild(icon(EYE));
  eye.addEventListener("click", function () {
    var show = input.type === "password";
    input.type = show ? "text" : "password";
    eye.setAttribute("aria-label", show ? "Sembunyikan key" : "Tampilkan key");
    eye.replaceChildren(icon(show ? EYE_OFF : EYE));
    input.focus();
  });
  input.parentNode.appendChild(eye);
  /* Enter sudah ditangani app.js, jadi tidak ditambah lagi di sini (supaya tidak login dua kali). */

  /* 2. Tombol Masuk menjadi "Memproses..." selama menunggu jawaban server */
  if (btnLogin) {
    var label = btnLogin.textContent;
    var timer = null;
    function idle() {
      clearTimeout(timer);
      btnLogin.disabled = false;
      btnLogin.classList.remove("is-loading");
      btnLogin.textContent = label;
    }
    btnLogin.addEventListener("click", function () {
      if (btnLogin.disabled) return;
      btnLogin.disabled = true;
      btnLogin.classList.add("is-loading");
      btnLogin.textContent = "Memproses...";
      timer = setTimeout(idle, 12000); /* jaga-jaga kalau server tidak menjawab */
    });
    /* Pulihkan tombol saat ada pesan error, atau saat login sukses (halaman masuk disembunyikan) */
    if (msg) new MutationObserver(idle).observe(msg, { childList: true, characterData: true, subtree: true, attributes: true });
    if (loginBox) new MutationObserver(function () { if (loginBox.classList.contains("hide")) idle(); }).observe(loginBox, { attributes: true, attributeFilter: ["class"] });
  }

  /* 3. Tautan bantuan "Hubungi penjual" */
  var slot = document.getElementById("contactSlot");
  if (slot && /^https:\/\//i.test(CONTACT_URL)) {
    var a = document.createElement("a");
    a.href = CONTACT_URL;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = "Hubungi penjual";
    slot.replaceChildren(a, document.createTextNode("."));
  }
})();
