(function () {
    const tabs = [...document.querySelectorAll(".landing-demo-tabs [role=tab]")];
    const select = (active) => {
        tabs.forEach(tab => {
            const selected = tab === active;
            tab.setAttribute("aria-selected", String(selected));
            tab.tabIndex = selected ? 0 : -1;
            document.getElementById(tab.getAttribute("aria-controls")).hidden = !selected;
        });
    };
    tabs.forEach((tab, index) => {
        tab.addEventListener("click", () => select(tab));
        tab.addEventListener("keydown", event => {
            const previous = (index + tabs.length - 1) % tabs.length;
            const following = (index + 1) % tabs.length;
            const next = {
                ArrowLeft: previous,
                ArrowUp: previous,
                ArrowRight: following,
                ArrowDown: following,
                Home: 0,
                End: tabs.length - 1,
            }[event.key];
            if (next === undefined) return;
            event.preventDefault();
            select(tabs[next]);
            tabs[next].focus();
        });
    });
})();

(async () => {
    const list = document.getElementById("landingPlans");
    const status = document.getElementById("landingPlanStatus");
    const priceCta = document.getElementById("landingPriceCta");
    const rupiah = new Intl.NumberFormat(gsLocale, { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
    const descriptions = {
        autostore: "Mulai dan kelola toko Discord selama 30 hari.",
        autostore90: "Tiga bulan akses panel untuk toko yang sedang berkembang.",
        autostore365: "Setahun akses panel dengan satu pembayaran.",
        autostoreLifetime: "Akses lisensi tanpa masa kedaluwarsa.",
    };
    const element = (tag, value) => {
        const node = document.createElement(tag);
        node.textContent = value;
        return node;
    };
    try {
        const response = await fetch("/api/shop-info");
        if (!response.ok) throw new Error("Paket gagal dimuat");
        const { packages } = await response.json();
        const recurring = packages.filter(plan => !plan.lifetime && plan.days > 0);
        if (recurring.length) {
            const startingPrice = Math.min(...recurring.map(plan => plan.price));
            priceCta.textContent = gsT("Paket mulai {0}", rupiah.format(startingPrice));
        }
        const cards = packages.map(plan => {
            const card = document.createElement("article");
            const heading = document.createElement("div");
            heading.className = "landing-plan-heading";
            heading.append(element("h3", plan.name), element("p", gsT(descriptions[plan.id] || "Akses panel GevraStore.")));
            if (plan.id === "autostore365") {
                const badge = element("span", gsT("Paling hemat"));
                badge.className = "landing-chip landing-chip-mint landing-plan-badge";
                heading.append(badge);
                card.classList.add("landing-plan-featured");
            }
            const link = element("a", gsT("Pilih paket"));
            link.href = "/beli.html?" + new URLSearchParams({ paket: plan.id });
            link.className = plan.id === "autostore365" ? "landing-btn" : "landing-btn landing-outline";
            link.setAttribute("aria-label", gsT("Pilih paket") + " " + plan.name);
            const price = document.createElement("div");
            price.className = "landing-plan-price";
            price.append(element("strong", rupiah.format(plan.price)), element("span", gsPlanPeriod(plan)));
            const dl = element("span", gsT("Memuat kurs DL…"));
            dl.className = "plan-dl-price";
            dl.dataset.dlPrice = plan.price;
            card.append(heading, price);
            const months = { 90: 3, 365: 12 }[plan.days];
            if (!plan.lifetime && months) {
                const average = element("span", gsT("Setara {0} per bulan", rupiah.format(Math.round(plan.price / months))));
                average.className = "landing-monthly";
                card.append(average);
            }
            card.append(dl, link);
            return card;
        });
        list.replaceChildren(...cards);
        status.textContent = cards.length ? "" : gsT("Belum ada paket yang tersedia.");
        if (cards.length) gsFetchDLRate().then(quote => {
            list.querySelectorAll("[data-dl-price]").forEach(line => {
                line.textContent = gsT("Estimasi: {0}", gsConvertDL(Number(line.dataset.dlPrice), quote));
            });
        }).catch(() => {
            list.querySelectorAll("[data-dl-price]").forEach(line => { line.textContent = gsT("Kurs DL belum tersedia"); });
        });
    } catch {
        list.replaceChildren();
        status.textContent = gsT("Daftar paket belum bisa dimuat. Coba buka halaman pembelian.");
    } finally {
        list.setAttribute("aria-busy", "false");
    }
})();
