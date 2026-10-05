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
let shop = require("../../Schema/shop.js");
const { Owner } = require("../../config/config.json");
module.exports = {
    name: 'removestock',
    description: "Remove Stock Of Product",
    accessableby: "admin",
    options: [
        {
            name: "code",
            description: "Code Of Product",
            type: ApplicationCommandOptionType.String,
            required: true
        },
        {
            name: "amount",
            description: "Howmany For The Remove Stock?",
            type: ApplicationCommandOptionType.Number,
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
        const amount = interaction.options.getNumber("amount");

        const getCodes = await list
            .findOne({ code: code })
            .then((d) => {
                return d;
            })
            .catch(console.error);

        if (!getCodes) return interaction.reply({
            content: `Product With That Code Doesn't Exist`,
            ephemeral: true
        });

        let getCode = await shop
            .find({ code: code })
            .then((res) => {
                return res;
            })
            .catch(console.error);

        if (getCode.length < 1) return interaction.reply({
            content: `**Not Have Stock Right Now!**`,
            ephemeral: true
        });

        let text = "";
        for (let i = 0; i < amount; i++) {
            let data = await shop
                .findOneAndDelete({ code: code })
                .then((res) => {
                    return res;
                })
                .catch(console.error);
            text += data.data + "\n";
        }

        let sam = '```\n' + text + '\n```';
        let embed = new EmbedBuilder()
            .setTitle("REMOVE STOCK")
            .setDescription(`**Remove Stock In ${code}**\n**Stock Has Been Removed:**\n${sam}`)
            .setTimestamp();
        
        await interaction.reply({
            embeds:[embed],
            ephemeral: true
        });
    }
}