/* Tombol mode terang/gelap. Pilihan disimpan di browser. Tanpa inline script (aman untuk CSP). */
(function () {
  var KEY = "gs-theme", root = document.documentElement;
  function read() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function write(v) { try { localStorage.setItem(KEY, v); } catch (e) {} }
  function apply(t) {
    var theme = t === "light" ? "light" : "dark";
    root.setAttribute("data-theme", theme);
    var themeColor = document.querySelector('meta[name="theme-color"]');
    if (themeColor) themeColor.content = theme === "light" ? "#f7f7f7" : "#08161c";
  }
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
      btn.setAttribute("aria-label", light ? gsT("Ganti ke mode gelap") : gsT("Ganti ke mode terang"));
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

/* Dialog konfirmasi / info / isian pengganti confirm(), alert(), prompt() bawaan browser.
   Dipakai di panel, admin, dan halaman beli. Semua teks dipasang lewat textContent (aman untuk CSP).
   gsConfirm(pesan, { okText, cancelText, danger, title }) -> Promise<boolean>
   gsAlert(pesan, { title })                              -> Promise<void>
   gsPrompt(pesan, { placeholder, okText, value })        -> Promise<string|null> (null = batal)  */
(function () {
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  function dialog(o) {
    return new Promise(function (resolve) {
      var prev = document.activeElement, done = false;
      var ov = el("div", "overlay gs-dlg-ov"), box = el("div", "modal gs-dlg");
      box.setAttribute("role", o.input ? "dialog" : "alertdialog"); box.setAttribute("aria-modal", "true"); box.tabIndex = -1;
      var id = "gsd" + Math.random().toString(36).slice(2, 8);
      var t = el("h2", "gs-dlg-title", o.title); t.id = id + "t"; box.setAttribute("aria-labelledby", id + "t");
      var m = el("p", "gs-dlg-msg", o.message); m.id = id + "m"; box.setAttribute("aria-describedby", id + "m");
      box.append(t, m);
      var input = null;
      if (o.input) { input = document.createElement("input"); input.type = "text"; input.maxLength = 200; input.value = o.value || ""; input.placeholder = o.placeholder || ""; input.setAttribute("aria-label", o.title); box.append(input); }
      var row = el("div", "row gs-dlg-actions"), ok = el("button", o.danger ? "bad" : "pri", o.okText), no = null;
      if (o.cancelText) { no = el("button", "", o.cancelText); row.append(no); }
      row.append(ok); box.append(row); ov.append(box); document.body.append(ov);

      function finish(v) {
        if (done) return; done = true;
        document.removeEventListener("keydown", onKey, true); ov.remove();
        try { if (prev && prev.focus && document.contains(prev)) prev.focus(); } catch (e) {}
        resolve(v);
      }
      function onKey(e) {
        if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); finish(o.input ? null : (o.cancelText ? false : undefined)); }
        else if (e.key === "Enter" && input && document.activeElement === input) { e.preventDefault(); e.stopImmediatePropagation(); finish(input.value); }
        else if (e.key === "Tab") {
          var f = Array.prototype.filter.call(box.querySelectorAll("button,input"), function (x) { return !x.disabled; });
          if (!f.length) return;
          var first = f[0], last = f[f.length - 1];
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      }
      document.addEventListener("keydown", onKey, true);
      ok.addEventListener("click", function () { finish(o.input ? input.value : (o.cancelText ? true : undefined)); });
      if (no) no.addEventListener("click", function () { finish(o.input ? null : false); });
      ov.addEventListener("mousedown", function (e) { if (e.target === ov) finish(o.input ? null : (o.cancelText ? false : undefined)); });
      /* Dialog bahaya: fokus awal di Batal supaya Enter tidak langsung menghapus. */
      (input || (o.danger && no) || ok).focus();
    });
  }

  window.gsConfirm = function (message, opts) {
    opts = opts || {};
    return dialog({ title: opts.title || (opts.danger ? gsT("Yakin?") : gsT("Konfirmasi")), message: String(message), okText: opts.okText || (opts.danger ? gsT("Ya, lanjutkan") : "OK"), cancelText: opts.cancelText || gsT("Batal"), danger: !!opts.danger });
  };
  window.gsAlert = function (message, opts) {
    opts = opts || {};
    return dialog({ title: opts.title || "Info", message: String(message), okText: "OK", cancelText: "" });
  };
  window.gsPrompt = function (message, opts) {
    opts = opts || {};
    return dialog({ title: opts.title || gsT("Isi dulu"), message: String(message), okText: opts.okText || "OK", cancelText: gsT("Batal"), input: true, placeholder: opts.placeholder, value: opts.value });
  };
})();
