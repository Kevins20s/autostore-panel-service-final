/* Tombol tampilkan/sembunyikan key di halaman masuk (tanpa inline script, aman untuk CSP) */
(function () {
  var input = document.getElementById("key");
  if (!input) return;
  var wrap = input.parentNode;
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
  var EYE = ["M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z", "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"];
  var EYE_OFF = ["M3 3l18 18", "M10.6 6.1A9.9 9.9 0 0 1 12 6c6.4 0 10 6 10 6a17 17 0 0 1-3.2 3.9", "M6.6 7.6C3.8 9.4 2 12 2 12s3.6 6 10 6c1.5 0 2.8-.3 4-.8", "M9.9 9.9a3 3 0 0 0 4.2 4.2"];
  var btn = document.createElement("button");
  btn.type = "button";
  btn.className = "key-eye";
  btn.setAttribute("aria-label", "Tampilkan key");
  btn.appendChild(icon(EYE));
  btn.addEventListener("click", function () {
    var show = input.type === "password";
    input.type = show ? "text" : "password";
    btn.setAttribute("aria-label", show ? "Sembunyikan key" : "Tampilkan key");
    btn.replaceChildren(icon(show ? EYE_OFF : EYE));
    input.focus();
  });
  wrap.appendChild(btn);
  /* Enter di kolom key = tekan Masuk */
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter") { var b = document.getElementById("btnLogin"); if (b) b.click(); }
  });
})();
