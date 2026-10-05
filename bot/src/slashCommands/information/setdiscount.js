let {
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
let list = require("../../Schema/list.js");
let Price = require("../../Schema/priceproduct.js");
let disc = require("../../Schema/discount.js");
let { Owner } = require("../../config/config.json");
const price = require("../../Schema/priceproduct.js");
module.exports = {
    name: 'setdiscount',
    description: "Set discount For Product",
    accessableby: "admin",
    options: [
        {
            name: "code",
            description: "Code Of Product",
            type: ApplicationCommandOptionType.String,
            required: true
        },
        {
            name: "discount",
            description: "Howmuch for discount?",
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
        const wut = interaction.options.getString("code");
        const howmuch = interaction.options.getNumber("discount");
        const getCode = await list
            .findOne({ code: wut })
            .then((res) => {
                return res;
            })
            .catch(console.error);

        if (!getCode) return interaction.reply({
            content: "Code Not Found",
            ephemeral: true
        });

        let price = await Price
            .findOne({ code: wut })
            .then((d) => {
                return d?.price;
            })
            .catch(console.error);

        if (!price) return interaction.reply({
            content: "Set Price First Before Use This Commands!",
            ephemeral: true
        });

        if (howmuch > 100) return interaction.reply({
            content:"Max Discount Is 100%",
            ephemeral: true
        });

        if (howmuch < 1) return interaction.reply({
            content:"Minimun Discount 1%",
            ephemeral: true
        });

        let dik = howmuch / 100;

        if (!isNaN(howmuch)) {
            await disc.findOneAndUpdate(
                { code: wut },
                { $set: { discount: dik } },
                { upsert: true, new: true }
            )
            .then((s) => {
                interaction.reply({
                    content:`Successfully Set Discount **${howmuch}%** For **${wut}**`,
                    ephemeral: true
                });
            })
        } else {
            interaction.reply({ content: `Number No Falid!`, ephemeral: true });
        }
    }
}