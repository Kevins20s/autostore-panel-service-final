/**
 * Definisi semua jenis jasa yang bisa di-order lewat panel Auto Store.
 *
 * CATATAN PENTING:
 * Field untuk MOVE dan PROVIDER dicontek langsung dari form yang sudah kamu
 * pakai (screenshot "Order MOVE" & "Order PROVIDER"). Field untuk PLANT,
 * HARVEST, HARVEST MOVE, dan SPLICE adalah perkiraan/ekstrapolasi mengikuti
 * pola yang sama (belum ada contoh form aslinya) — silakan sesuaikan label,
 * placeholder, atau tambah/kurangi field di bawah ini, semua tempat lain
 * (modal, validasi, embed panel) otomatis ikut menyesuaikan.
 *
 * Batasan Discord: 1 modal maksimal 5 text input, jadi tiap tipe di bawah
 * ini fieldsnya (amountField + fields + kode promo) dijaga maksimal 5.
 */

const JASA_TYPES = {
    PLANT: {
        label: "PLANT",
        unit: "World",
        defaultPrice: 30,
        amountField: {
            id: "jumlah",
            label: "Jumlah World",
            placeholder: "Contoh: 5",
        },
        // Field sama persis kayak PROVIDER, sesuai permintaan
        fields: [
            {
                id: "worldStorage",
                label: "Nama World Storage (STORAGE|DOORID)",
                placeholder: "Contoh:\nSTORAGE1|DOORID",
                style: "Paragraph",
            },
            {
                id: "worldFarm",
                label: "Nama World Farm (FARM:DOORID:IDSEED)",
                placeholder: "Contoh:\nFARM1:DOORID:IDSEED",
                style: "Paragraph",
            },
        ],
    },
    HARVEST: {
        label: "HARVEST",
        unit: "World",
        defaultPrice: 30,
        amountField: {
            id: "jumlah",
            label: "Jumlah World",
            placeholder: "Contoh: 5",
        },
        // Field sama persis kayak PROVIDER, sesuai permintaan
        fields: [
            {
                id: "worldStorage",
                label: "Nama World Storage (STORAGE|DOORID)",
                placeholder: "Contoh:\nSTORAGE1|DOORID",
                style: "Paragraph",
            },
            {
                id: "worldFarm",
                label: "Nama World Farm (FARM:DOORID:IDSEED)",
                placeholder: "Contoh:\nFARM1:DOORID:IDSEED",
                style: "Paragraph",
            },
        ],
    },
    "HARVEST MOVE": {
        label: "HARVEST MOVE",
        unit: "World",
        defaultPrice: 40,
        amountField: {
            id: "jumlah",
            label: "Jumlah World",
            placeholder: "Contoh: 1",
        },
        fields: [
            {
                id: "worldFarm",
                label: "Nama World Farm (FARM|DOORID)",
                placeholder: "Contoh:\nFARM1|DOORID",
                style: "Paragraph",
            },
            {
                id: "worldTujuan",
                label: "Nama World Tujuan (WORLD|DOORID)",
                placeholder: "Contoh:\nWORLDTUJUAN|DOORID",
                style: "Paragraph",
            },
        ],
    },
    MOVE: {
        label: "MOVE",
        unit: "Item",
        defaultPrice: 1, // harga per 200 item (per block)
        blockSize: 200,
        amountField: {
            id: "jumlah",
            label: "Jumlah Item/Block (1 WL = 200 Item)",
            placeholder: "Contoh: 200",
        },
        fields: [
            {
                id: "worldAsal",
                label: "Nama World Asal (WORLD|DOORID)",
                placeholder: "Contoh:\nWORLDASAL|DOORID",
                style: "Paragraph",
            },
            {
                id: "worldTujuan",
                label: "Nama World Tujuan (WORLD|DOORID)",
                placeholder: "Contoh:\nWORLDTUJUAN|DOORID",
                style: "Paragraph",
            },
        ],
    },
    PROVIDER: {
        label: "PROVIDER",
        unit: "World",
        defaultPrice: 40,
        amountField: {
            id: "jumlah",
            label: "Jumlah World",
            placeholder: "Contoh: 1",
        },
        fields: [
            {
                id: "worldStorage",
                label: "Nama World Storage (STORAGE|DOORID)",
                placeholder: "Contoh:\nSTORAGE1|DOORID",
                style: "Paragraph",
            },
            {
                id: "worldFarm",
                label: "Nama World Farm (FARM:DOORID:IDSEED)",
                placeholder: "Contoh:\nFARM1:DOORID:IDSEED",
                style: "Paragraph",
            },
        ],
    },
    SPLICE: {
        label: "SPLICE",
        unit: "World",
        defaultPrice: 45,
        amountField: {
            id: "jumlah",
            label: "Jumlah World",
            placeholder: "Contoh: 1",
        },
        // Field sama persis kayak PROVIDER, sesuai permintaan
        fields: [
            {
                id: "worldStorage",
                label: "Nama World Storage (STORAGE|DOORID)",
                placeholder: "Contoh:\nSTORAGE1|DOORID",
                style: "Paragraph",
            },
            {
                id: "worldFarm",
                label: "Nama World Farm (FARM:DOORID:IDSEED)",
                placeholder: "Contoh:\nFARM1:DOORID:IDSEED",
                style: "Paragraph",
            },
        ],
    },
};

// Semua tipe punya field "Kode Promo / Diskon (Opsional)" sebagai text input terakhir
const PROMO_FIELD = {
    id: "promo",
    label: "Kode Promo / Diskon (Opsional)",
    placeholder: "Masukkan kode promo jika ada (contoh: DISKON50)",
};

function getJasaTypeKeys() {
    return Object.keys(JASA_TYPES);
}

function getJasaType(type) {
    return JASA_TYPES[type] || null;
}

/**
 * Hitung total harga (dalam WL) untuk sebuah order.
 * @param {string} type
 * @param {number} amount
 * @param {number} unitPrice - harga per unit yang tersimpan di jasaConfig
 * @param {number} discount - desimal 0-1 dari kode promo (0 kalau tidak ada)
 */
function calcJasaPrice(type, amount, unitPrice, discount = 0) {
    const def = getJasaType(type);
    if (!def) return 0;

    let base;
    if (def.blockSize) {
        // MOVE: dihitung per block (misal 1 WL per 200 item), dibulatkan ke atas
        const blocks = Math.ceil(Number(amount) / def.blockSize);
        base = blocks * Number(unitPrice);
    } else {
        base = Number(amount) * Number(unitPrice);
    }

    const discounted = base - base * Number(discount || 0);
    return Math.max(0, Math.round(discounted));
}

module.exports = { JASA_TYPES, PROMO_FIELD, getJasaTypeKeys, getJasaType, calcJasaPrice };
