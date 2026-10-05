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
const Price = require("../../Schema/priceproduct.js");
const shop = require("../../Schema/shop.js");
const { Owner } = require("../../config/config.json");
module.exports = {
    name: 'changecode',
    description: "Change Code Of Product",
    accessableby: "admin",
    options: [
        {
            name: "code",
            description: "Code Of Product",
            type: ApplicationCommandOptionType.String,
            required: true
        },
        {
            name: "newcode",
            description: "New Code For Products",
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
        const productCode = interaction.options.getString("newcode");
        const userars = await client.users.fetch(Owner);

        const getCode = await list
            .findOne({ code: code })
            .then((d) => {
                return d;
            })
            .catch(console.error);

        if (!getCode) return interaction.reply({
            content: "Product With That Code Doesn't Exist",
            ephemeral: true
        });
        
        await list
            .updateOne(
                {
                    code: code,
                },
                {
                    code: productCode,
                }
            )
            .then(console.log)
            .catch(console.error);
        await Price
            .updateOne(
                {
                    code: code,
                },
                {
                    code: productCode,
                }
            )
            .then(console.log)
            .catch(console.error);
        await shop
            .updateOne(
                {
                    code: code,
                },
                {
                    code: productCode,
                }
            )
            .then(console.log)
            .catch(console.error);

        await interaction.reply({
            content: `Code Changed To **${productCode}**`,
            ephemeral: true
        });

        const sendToOwner = new EmbedBuilder()
            .setTitle("Change Product Code History")
            .setDescription(
                `
         New Code: ${productCode}
       `.replace(/ {2,}/g, "")
            )
            .setTimestamp();
        userars.send({ embeds: [sendToOwner] });
    }
}