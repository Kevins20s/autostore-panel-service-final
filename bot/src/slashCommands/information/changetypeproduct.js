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
const { Owner } = require("../../config/config.json");
module.exports = {
    name: 'changetype',
    description: "Change Type Of Product",
    accessableby: "admin",
    options: [
        {
            name: "code",
            description: "Code Of Product",
            type: ApplicationCommandOptionType.String,
            required: true
        },
        {
            name: "type",
            description: "New Type For Product",
            type: ApplicationCommandOptionType.String,
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
        const typeName = interaction.options.getString("type");

        const getCode = await list
            .findOne({ code: code })
            .catch(console.error);

        if (!getCode) return interaction.reply({
            content: `Product With That Code Doesn't Exist`,
            ephemeral: true
        });

        if (typeName) {
            if (typeName.includes("script") || typeName.includes("yes")) {
                await list
                    .updateOne(
                        {
                            code: code,
                        },
                        {
                            type: typeName,
                        }
                    )
                    .then((d) => {
                        interaction.reply({ content: `Product Type Changed **${getCode.type}** to **${typeName}**`, ephemeral: true });
                    })
                    .catch(console.error);
            } else {
                interaction.reply({
                    content: `Only Put **script/yes**`,
                    ephemeral: true
                });
            }
        }
    }
}