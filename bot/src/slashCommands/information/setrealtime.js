const {
    EmbedBuilder,
    Client,
    CommandInteraction,
    ApplicationCommandOptionType,
    PermissionFlagsBits,
} = require("discord.js");
let RealtimeChannel = require("../../Schema/RealtimeChannel.js");
let { Owner } = require("../../config/config.json");

module.exports = {
    name: 'setrealtime',
    description: "Set Realtime Channel! (bisa dipisah per kategori produk)",
    accessableby: "admin",
    options: [
        {
            name: "channel",
            description: "Where Channel Do You Want To Send Realtime?",
            type: ApplicationCommandOptionType.Channel,
            required: true
        },
        {
            name: "kategori",
            description: "Kategori produk (harus sama persis kayak field 'kategori' di /addproduct).",
            type: ApplicationCommandOptionType.String,
            required: false
        }
    ],
    /** 
     * @param {Client} client 
     * @param {CommandInteraction} interaction
     * @param {String[]} args 
     */
    run: async (client, interaction, args) => {
        const data1 = interaction.options.getChannel("channel");
        const kategoriInput = interaction.options.getString("kategori");
        const kategori = kategoriInput ? kategoriInput.trim() : "ALL";

        await interaction.deferReply({ ephemeral: true });
        if (!data1 || data1.guildId !== interaction.guildId || !data1.isTextBased() || typeof data1.send !== "function") {
            return interaction.editReply({ content: "Pilih channel teks di server ini untuk katalog toko." });
        }
        const member = interaction.guild.members.me || await interaction.guild.members.fetchMe();
        const permissions = data1.permissionsFor(member);
        const required = [
            [PermissionFlagsBits.ViewChannel, "Lihat Channel (View Channel)"],
            [data1.isThread() ? PermissionFlagsBits.SendMessagesInThreads : PermissionFlagsBits.SendMessages, "Kirim Pesan (Send Messages)"],
            [PermissionFlagsBits.EmbedLinks, "Sematkan Tautan (Embed Links)"],
            [PermissionFlagsBits.ReadMessageHistory, "Baca Riwayat Pesan (Read Message History)"],
        ];
        const missing = required.filter(([flag]) => !permissions?.has(flag)).map(([, label]) => label);
        if (missing.length) {
            return interaction.editReply({ content: `Bot belum punya izin di ${data1}: **${missing.join(", ")}**.\n` +
                "Buka Edit Channel → Permissions → pilih role bot → izinkan akses tersebut, lalu ulangi /setrealtime." });
        }

        let message;
        try {
            message = await data1.send({
                content: kategori === "ALL"
                    ? `Prepare Auto Store Gevra`
                    : `Prepare Auto Store Gevra — Kategori: **${kategori}**`
            });

            await RealtimeChannel.findOneAndUpdate(
                { kategori },
                { $set: { channelId: data1.id, messageId: message.id }, $unset: { intervalSeconds: "" } },
                { upsert: true, new: true }
            );
        } catch (error) {
            if (message) await message.delete().catch(() => {});
            if (error.code === 50013 || error.code === 50001) {
                return interaction.editReply({ content: `Discord menolak akses bot ke ${data1}. Periksa izin role bot dan izin khusus channel, lalu ulangi /setrealtime.` });
            }
            throw error;
        }
        await interaction.editReply({ content: `Successfully Set Your Realtime To ${data1} (Kategori: **${kategori}**), MessageID: ${message.id}` });
    }
}
