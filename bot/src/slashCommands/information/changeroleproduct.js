const {
    EmbedBuilder,
    Client,
    CommandInteraction,
    ChannelType,
    AttachmentBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ApplicationCommandOptionType,
} = require("discord.js");
const list = require("../../Schema/list.js");
const { serverId, Owner } = require("../../config/config.json");
module.exports = {
    name: 'changerole',
    description: "Change Role Of Product",
    accessableby: "admin",
    options: [
        {
            name: "code",
            description: "Code Of Product",
            type: ApplicationCommandOptionType.String,
            required: true
        },
        {
            name: "role",
            description: "Tag Role For Change Role",
            type: ApplicationCommandOptionType.Role,
            required: true
        }
    ],
    /** 
     * @param {Client} client 
     * @param {CommandInteraction} interaction
     * @param {String[]} args 
     */
    run: async (client, interaction, args) => {
        const code = interaction.options.getString("code");
        const productRoles = interaction.options.getRole("role");
        const productRole = productRoles.id;
        const userars = await client.users.fetch(Owner);
        const guild = client.guilds.cache.get(serverId);

        const getCode = await list
            .findOne({ code: code })
            .catch(console.error);

        if (!getCode) return interaction.reply({
            content: `Product With That Code Doesnt Exit`,
            ephemeral: true
        });

        await list
            .findOneAndUpdate(
                {
                    code: code,
                },
                {
                    role: productRole,
                }
            )
            .then((d) => {
                const role = guild.roles.cache.get(getCode.role);
                interaction.reply({
                    content: `Role Changed **${role}** To **${productRoles}**`,
                    ephemeral: true
                });

                const sendToOwner = new EmbedBuilder()
                    .setTitle("Change Product Role History")
                    .setDescription(
                        `
                    New Role: ${productRole}
                `.replace(/ {2,}/g, "")
                    )
                    .setTimestamp();
                userars.send({ embeds: [sendToOwner] });
            })
            .catch(console.error);
    }
}