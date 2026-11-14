"use strict";

const { ApplicationCommandOptionType: T, ChannelType } = require("discord.js");
const { runCommand, safeRun } = require("../../utils/preorderDiscord");
const code = { name: "kode", description: "Kode preorder, contoh PO-AB12CD34EF", type: T.String, required: true };

module.exports = {
    name: "preorder",
    description: "Tiket preorder, setoran stok bertahap, dan pengambilan pembeli",
    accessableby: "everyone",
    options: [
        { name: "setup", description: "Admin membuat panel dan mengatur kategori tiket preorder", type: T.Subcommand, options: [
            { name: "channel", description: "Channel untuk tombol Buat Preorder", type: T.Channel, channel_types: [ChannelType.GuildText, ChannelType.GuildAnnouncement], required: true },
            { name: "kategori", description: "Kategori Discord untuk tiket privat preorder", type: T.Channel, channel_types: [ChannelType.GuildCategory], required: true },
            { name: "admin", description: "Role yang boleh mengelola preorder, selain owner/admin bot", type: T.Role, required: false },
        ] },
        { name: "list", description: "Lihat daftar preorder dan progresnya, admin melihat semua pembeli", type: T.Subcommand, options: [
            { name: "halaman", description: "Halaman daftar preorder", type: T.Integer, min_value: 1, max_value: 100000, required: false },
        ] },
        { name: "status", description: "Cek status dan buka kembali tiket preorder", type: T.Subcommand, options: [code] },
        { name: "setor", description: "Admin menyetor stok, satu stok per baris", type: T.Subcommand, options: [code,
            { name: "stok", description: "Teks stok, satu stok per baris. Pilih stok atau file", type: T.String, required: false },
            { name: "file", description: "File .txt maksimal 1 MB, satu stok per baris", type: T.Attachment, required: false },
        ] },
        { name: "bayar", description: "Admin menandai pembayaran manual preorder sudah lunas", type: T.Subcommand, options: [code] },
        { name: "tutup", description: "Tutup preorder selesai atau batalkan pesanan tanpa pembayaran dan stok", type: T.Subcommand, options: [code] },
    ],
    run: (client, interaction) => safeRun(interaction, () => runCommand(client, interaction)),
};
