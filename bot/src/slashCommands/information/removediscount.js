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
let disc = require("../../Schema/discount.js");
let client = require('../../index.js');
let { Owner } = require('../../config/config.json');
module.exports = {
    name: 'removediscount',
    description: "Remove Discount From Stock List",
    accessableby: "admin",
    options: [
        {
            name: "code",
            description: "Code Of Product",
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

        const getCode = await disc
            .findOne({ code: code })
            .then((res) => {
                return res;
            })
            .catch(console.error);

        if (!getCode) return interaction.reply({
            content: "Product Not Have Discount/Not Discount Right Now",
            ephemeral: true
        });

        await disc
            .deleteOne({ code: code })
            .then(async (d) => {
                await interaction.reply({
                    content: "Discount Removed For** " + code + "**",
                    ephemeral: true
                });
            })
            .catch(console.error);
    }
}