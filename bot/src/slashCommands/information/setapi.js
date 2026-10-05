const { EmbedBuilder, ApplicationCommandOptionType } = require("discord.js");
const ApiSetting = require("../../Schema/apiSetting.js");
const { COLOR, Benar, Salah, Warning } = require("../../config/configemoji.json");

module.exports = {
    name: "setapi",
    description: "Nyalakan/matikan API harga live gtid.pro (kalau mati, pakai harga manual /setwlprice)",
    accessableby: "admin",
    options: [
        {
            name: "status",
            description: "Pilih status API gtid.pro",
            type: ApplicationCommandOptionType.String,
            required: true,
            choices: [
                { name: "Nyala (pakai harga live gtid.pro)", value: "on" },
                { name: "Mati (paksa pakai harga manual /setwlprice)", value: "off" },
            ],
        },
    ],
    run: async (client, interaction, args) => {
        const status = interaction.options.getString("status");
        const useLiveApi = status === "on";

        const updated = await ApiSetting.findOneAndUpdate(
            {},
            { $set: { useLiveApi } },
            { upsert: true, new: true }
        ).catch(console.error);

        if (!updated) {
            return interaction.reply({
                content: `${Warning} Gagal mengubah status API, coba lagi.`,
                ephemeral: true,
            });
        }

        const embed = new EmbedBuilder()
            .setTitle("Status API Harga WL Diubah")
            .setDescription(
                useLiveApi
                    ? `${Benar} API **gtid.pro** sekarang **NYALA**. Bot akan pakai harga live, dan otomatis fallback ke harga manual (/setwlprice) kalau API sedang down.`
                    : `${Salah} API **gtid.pro** sekarang **DIMATIKAN**. Bot akan langsung pakai harga manual dari /setwlprice tanpa mencoba fetch live sama sekali.`
            )
            .setColor(COLOR)
            .setTimestamp();

        await interaction.reply({ embeds: [embed], ephemeral: true });
    },
};
