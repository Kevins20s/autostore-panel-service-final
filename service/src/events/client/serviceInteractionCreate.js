const client = require("../../index");
const { Owner, Admin } = require("../../config/runtime.js");
const { Warning } = require("../../config/emoji.js");

module.exports = { name: "Service Interaction Guard" };

client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const command = client.slash.get(interaction.commandName);
    if (!command) return;

    try {
        if (command.accessableby === "owner") {
            if (!interaction.guild) return interaction.reply({ content: `${Warning} Gunakan command ini di server.`, ephemeral: true });
            if (interaction.user.id !== Owner) return interaction.reply({ content: `${Warning} Hanya Owner yang dapat menggunakan command ini.`, ephemeral: true });
        } else if (command.accessableby === "admin") {
            if (!interaction.guild) return interaction.reply({ content: `${Warning} Gunakan command ini di server.`, ephemeral: true });
            if (!Admin.includes(interaction.user.id) && interaction.user.id !== Owner) {
                return interaction.reply({ content: `${Warning} Hanya Admin/Owner yang dapat menggunakan command ini.`, ephemeral: true });
            }
        }

        await command.run(client, interaction, interaction.options);
    } catch (err) {
        console.error(err);
        const msg = `${Warning} Terjadi kesalahan: \`${err.message}\``;
        if (interaction.deferred || interaction.replied) await interaction.editReply({ content: msg }).catch(() => {});
        else await interaction.reply({ content: msg, ephemeral: true }).catch(() => {});
    }
});
