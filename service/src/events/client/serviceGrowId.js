const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require("discord.js");
const client = require("../../index");
const Bal = require("../../Schema/balance.js");

module.exports = { name: "Service GrowID" };

client.on("interactionCreate", async (interaction) => {
    try {
        if (interaction.isButton() && interaction.customId === "growid23") {
            const modal = new ModalBuilder().setCustomId("serviceGrowIdModal").setTitle("Set GrowID");
            const growid = new TextInputBuilder()
                .setCustomId("growid").setLabel("GrowID").setStyle(TextInputStyle.Short)
                .setMinLength(2).setMaxLength(50).setPlaceholder("Masukkan GrowID Growtopia").setRequired(true);
            const confirm = new TextInputBuilder()
                .setCustomId("confirm").setLabel("Konfirmasi GrowID").setStyle(TextInputStyle.Short)
                .setMinLength(2).setMaxLength(50).setPlaceholder("Masukkan kembali GrowID").setRequired(true);
            modal.addComponents(new ActionRowBuilder().addComponents(growid), new ActionRowBuilder().addComponents(confirm));
            return interaction.showModal(modal);
        }

        if (interaction.isModalSubmit() && interaction.customId === "serviceGrowIdModal") {
            const id = interaction.fields.getTextInputValue("growid").trim();
            const confirm = interaction.fields.getTextInputValue("confirm").trim();

            if (id.toLowerCase() !== confirm.toLowerCase())
                return interaction.reply({ content: "Konfirmasi GrowID tidak cocok.", ephemeral: true });

            const normalized = id.toLowerCase();
            const used = await Bal.findOne({ GrowID: normalized }).catch(() => null);
            if (used && used.DiscordID !== interaction.user.id)
                return interaction.reply({ content: "GrowID tersebut sudah digunakan akun lain.", ephemeral: true });

            await Bal.findOneAndUpdate(
                { DiscordID: interaction.user.id },
                {
                    $set: { GrowID: normalized, GrowIDNow: id },
                    $setOnInsert: { DiscordID: interaction.user.id, Balance: 0, Deposit: 0 }
                },
                { upsert: true, new: true }
            );

            return interaction.reply({ content: `✅ GrowID **${id}** berhasil disimpan.`, ephemeral: true });
        }
    } catch (err) {
        console.error("[SERVICE GROWID]", err);
        if (!interaction.replied && !interaction.deferred)
            interaction.reply({ content: "Gagal menyimpan GrowID.", ephemeral: true }).catch(() => {});
    }
});
