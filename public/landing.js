(async () => {
    const list = document.getElementById("landingPlans");
    const status = document.getElementById("landingPlanStatus");
    const rupiah = new Intl.NumberFormat(gsLocale, { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
    const element = (tag, value) => {
        const node = document.createElement(tag);
        node.textContent = value;
        return node;
    };
    try {
        const response = await fetch("/api/shop-info");
        if (!response.ok) throw new Error("Paket gagal dimuat");
        const { packages } = await response.json();
        const cards = packages.map(plan => {
            const card = document.createElement("article");
            const link = element("a", gsT("Pilih paket"));
            link.href = "/beli.html?" + new URLSearchParams({ paket: plan.id });
            link.className = "landing-btn";
            link.setAttribute("aria-label", gsT("Pilih paket") + " " + plan.name);
            const price = element("strong", rupiah.format(plan.price));
            price.className = "landing-price";
            card.append(element("h3", plan.name), price, element("p", gsT("{0} hari", plan.days)), link);
            return card;
        });
        list.replaceChildren(...cards);
        status.textContent = cards.length ? "" : gsT("Belum ada paket yang tersedia.");
    } catch {
        list.replaceChildren();
        status.textContent = gsT("Daftar paket belum bisa dimuat. Coba buka halaman pembelian.");
    } finally {
        list.setAttribute("aria-busy", "false");
    }
})();
