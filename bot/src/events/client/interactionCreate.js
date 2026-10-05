const { PermissionsBitField, EmbedBuilder } = require('discord.js');
const client = require('../../index');
const { Owner, Admin } = require("../../config/config.json");

module.exports = {
    name: "interactionCreate"
};

client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    if (!interaction.type == 2) return;

    const command = client.slash.get(interaction.commandName);

    if (!command) return;

    try {
        if (command.accessableby === "owner") {
            if (!interaction.guild) {
                return interaction.reply({
                    content: `Only Use In Server`,
                    ephemeral: true
                });
            }

            if (interaction.user.id !== Owner) return interaction.reply({
                content: `**Only The Owner Can Use This Command!!**`,
                ephemeral: true
            });

            await command.run(client, interaction, interaction.options)
        } else if (command.accessableby === "admin") {
            if (!interaction.guild) {
                return interaction.reply({
                    content: `Only Use In Server`,
                    ephemeral: true
                });
            }

            if (!Admin.includes(interaction.user.id) && interaction.user.id !== Owner) return interaction.reply({
                content:`**Only Admin Or Owner Can Use This Commands!!**`,
                ephemeral: true
            });

            await command.run(client, interaction, interaction.options)
        } else {
            if (!interaction.guild) {
                return interaction.reply({
                    content: `Only Use In Server`,
                    ephemeral: true
                });
            }
            await command.run(client, interaction, interaction.options)
        }
    } catch (err) {
        console.log(err.stack);

        // Jaring pengaman: kalau command manapun error SEBELUM sempat balas ke
        // Discord, kasih tau user (bukan cuma log ke console doang), biar gak
        // pernah muncul "The application did not respond" tanpa penjelasan.
        const errorMessage = `⚠️ Terjadi kesalahan saat menjalankan command ini: \`${err.message}\``;

        if (interaction.deferred || interaction.replied) {
            await interaction.editReply({ content: errorMessage }).catch(() => {});
        } else {
            await interaction.reply({ content: errorMessage, ephemeral: true }).catch(() => {});
        }
    }
})
