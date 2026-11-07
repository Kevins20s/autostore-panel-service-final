"use strict";

(() => {
    const byId = id => document.getElementById(id);
    const quantity = byId("demoQuantity");
    const buy = byId("demoBuy");
    const history = byId("demoOrders");
    const number = new Intl.NumberFormat(gsLocale);
    let stock = 0;
    let sold = 0;

    function render() {
        byId("demoStock").textContent = number.format(stock);
        buy.disabled = stock === 0;
        byId("demoEmpty").hidden = sold > 0;
    }

    byId("demoRestock").addEventListener("submit", event => {
        event.preventDefault();
        const added = quantity.valueAsNumber;
        if (!Number.isInteger(added) || added < 1 || added > 999) return;
        stock += added;
        byId("demoStockMessage").textContent = gsT("{0} unit ditambahkan ke stok contoh.", number.format(added));
        byId("demoBuyMessage").textContent = gsT("Voucher tersedia. Coba simulasikan pembelian.");
        render();
    });

    buy.addEventListener("click", () => {
        if (!stock) return;
        stock--;
        sold++;
        const entry = document.createElement("li");
        const orderCode = "DEMO-" + String(sold).padStart(3, "0");
        entry.textContent = gsT("{0} · 1 Voucher Digital · 25 WL · Terkirim (simulasi)", orderCode);
        history.prepend(entry);
        byId("demoBuyMessage").textContent = gsT("Pesanan {0} tercatat. Sisa stok {1} unit.", orderCode, number.format(stock));
        try { localStorage.setItem("gs-order-demo-complete", "1"); } catch {}
        render();
    });

    byId("demoReset").addEventListener("click", () => {
        stock = sold = 0;
        quantity.value = "5";
        history.replaceChildren();
        byId("demoStockMessage").textContent = "";
        byId("demoBuyMessage").textContent = gsT("Tambahkan stok untuk mulai simulasi.");
        render();
        quantity.focus();
    });

    if (new URLSearchParams(location.search).get("from") === "panel") {
        for (const id of ["demoBack", "demoNext"]) {
            byId(id).href = "/#/dashboard";
            byId(id).textContent = gsT("Kembali ke ringkasan");
        }
    }
    render();
})();
