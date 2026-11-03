"use strict";
/* Helper UI bersama untuk panel pembeli (app.js) dan halaman admin (admin.js).
   Tanpa inline script supaya aman untuk CSP. */
(function () {
    const h = (tag, attrs = {}, ...kids) => {
        const e = document.createElement(tag);
        for (const [k, v] of Object.entries(attrs)) {
            if (k === "class") e.className = v;
            else if (k.startsWith("on")) e[k] = v;
            else if (v !== false && v != null) e.setAttribute(k, v === true ? "" : v);
        }
        for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
        return e;
    };

    // ---------- Toast ----------
    function toast(text, ok = true) {
        let box = document.getElementById("toast");
        if (!box) { box = h("div", { id: "toast" }); document.body.append(box); }
        box.setAttribute("aria-live", "polite");
        const t = h("div", { class: "t " + (ok ? "ok" : "err"), role: ok ? "status" : "alert" }, text);
        box.append(t);
        setTimeout(() => t.remove(), 4000);
    }

    // ---------- Modal (Esc menutup, role=dialog, fokus dikembalikan) ----------
    const stack = [];
    let seq = 0;
    const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

    function openDialog({ title, body, role = "dialog", closable = true, onClose, narrow = false }) {
        const prevFocus = document.activeElement;
        const ov = h("div", { class: "overlay" });
        const titleId = "dlg-title-" + ++seq;
        const heading = h("h2", { class: "m0", id: titleId }, title);
        const top = h("div", { class: "row sp" }, heading, closable ? h("button", { type: "button" }, "Tutup") : null);
        const box = h("div", { class: "modal" + (narrow ? " modal-narrow" : ""), role, "aria-modal": "true", "aria-labelledby": titleId, tabindex: "-1" }, top, ...body);
        ov.append(box);
        let closed = false;
        const entry = {
            el: ov,
            closable,
            close() {
                if (closed) return;
                closed = true;
                const i = stack.indexOf(entry);
                if (i >= 0) stack.splice(i, 1);
                ov.remove();
                if (!stack.length) document.body.classList.remove("modal-open");
                if (prevFocus && prevFocus.isConnected && prevFocus.focus) prevFocus.focus({ preventScroll: true });
                if (onClose) onClose();
            },
        };
        if (closable) {
            top.querySelector("button").onclick = entry.close;
            ov.onmousedown = (e) => { if (e.target === ov) entry.close(); };
        }
        stack.push(entry);
        document.body.classList.add("modal-open");
        document.body.append(ov);
        const first = box.querySelector("input:not([type=file]):not([type=checkbox]),textarea,select");
        (first || box).focus({ preventScroll: true });
        return entry;
    }

    document.addEventListener("keydown", (e) => {
        const top = stack[stack.length - 1];
        if (!top) return;
        if (e.key === "Escape" && top.closable) { e.preventDefault(); top.close(); return; }
        if (e.key === "Tab") { // jaga fokus tetap di dalam dialog teratas
            const items = [...top.el.querySelectorAll(FOCUSABLE)].filter((x) => x.offsetParent !== null || x === document.activeElement);
            if (!items.length) return;
            const first = items[0], last = items[items.length - 1];
            if (e.shiftKey && (document.activeElement === first || document.activeElement === top.el.firstChild)) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
    });

    function modal(title, ...body) {
        const d = openDialog({ title, body });
        return { close: d.close, el: d.el };
    }

    // Pengganti confirm() bawaan browser. Mengembalikan Promise<boolean>.
    function confirmDialog({ title = "Yakin?", message = "", confirmText = "Ya, lanjutkan", cancelText = "Batal", danger = false } = {}) {
        return new Promise((resolve) => {
            let done = false;
            const finish = (v) => { if (!done) { done = true; resolve(v); } };
            const ok = h("button", { type: "button", class: danger ? "bad" : "pri" }, confirmText);
            const no = h("button", { type: "button" }, cancelText);
            const d = openDialog({
                title, role: "alertdialog", narrow: true, onClose: () => finish(false),
                body: [h("p", { class: "confirm-msg" }, message), h("div", { class: "row end mt" }, no, ok)],
            });
            ok.onclick = () => { finish(true); d.close(); };
            no.onclick = () => d.close();
            setTimeout(() => (danger ? no : ok).focus({ preventScroll: true }), 0);
        });
    }

    // ---------- Salin ke clipboard ----------
    async function copyText(text) {
        try { await navigator.clipboard.writeText(text); return true; } catch { /* lanjut ke cara lama */ }
        try {
            const ta = h("textarea", { readonly: true, style: "position:fixed;opacity:0;top:0;left:0" });
            ta.value = text;
            document.body.append(ta);
            ta.select();
            const ok = document.execCommand("copy");
            ta.remove();
            return ok;
        } catch { return false; }
    }

    // ---------- Skeleton loading ----------
    const skeleton = (rows = 3) => h("div", { class: "skel-page", "aria-busy": "true", "aria-label": "Memuat" },
        h("div", { class: "skel skel-title" }),
        h("div", { class: "skel skel-line" }),
        ...Array.from({ length: rows }, () => h("div", { class: "skel skel-card" })));

    window.UI = { h, toast, modal, confirmDialog, copyText, skeleton };
})();
