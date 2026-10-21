/* Tombol mode terang/gelap. Pilihan disimpan di browser. Tanpa inline script (aman untuk CSP). */
(function () {
  var KEY = "gs-theme", root = document.documentElement;
  function read() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function write(v) { try { localStorage.setItem(KEY, v); } catch (e) {} }
  function apply(t) { if (t === "light") root.setAttribute("data-theme", "light"); else root.removeAttribute("data-theme"); }
  apply(read()); /* diterapkan sedini mungkin supaya tidak berkedip */

  document.addEventListener("DOMContentLoaded", function () {
    var ns = "http://www.w3.org/2000/svg";
    function icon(paths) {
      var svg = document.createElementNS(ns, "svg");
      svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("aria-hidden", "true");
      paths.forEach(function (d) { var p = document.createElementNS(ns, "path"); p.setAttribute("d", d); svg.appendChild(p); });
      return svg;
    }
    var SUN = ["M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z", "M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"];
    var MOON = ["M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"];
    var btn = document.createElement("button");
    btn.type = "button"; btn.className = "theme-toggle";
    function draw() {
      var light = root.getAttribute("data-theme") === "light";
      btn.setAttribute("aria-label", light ? "Ganti ke mode gelap" : "Ganti ke mode terang");
      btn.title = btn.getAttribute("aria-label");
      btn.replaceChildren(icon(light ? MOON : SUN));
    }
    btn.addEventListener("click", function () {
      var next = root.getAttribute("data-theme") === "light" ? "dark" : "light";
      apply(next); write(next); draw();
    });
    draw();
    document.body.appendChild(btn);
  });
})();
