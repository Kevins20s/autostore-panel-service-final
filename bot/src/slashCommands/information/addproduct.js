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
let client = require('../../index.js');
let { Owner } = require('../../config/config.json');
module.exports = {
    name: 'addproduct',
    description: "Add Product In Database",
    accessableby: "admin",
    options: [
        {
            name: "code",
            description: "Code Of Product",
            type: ApplicationCommandOptionType.String,
            required: true
        },
        {
            name: "name",
            description: "Name Of Product",
            type: ApplicationCommandOptionType.String,
            required: true
        },
        {
            name: "role",
            description: "Tag Role For Change Role",
            type: ApplicationCommandOptionType.Role,
            required: true
        },
        {
            name: "type",
            description: "Type: script/yes",
            type: ApplicationCommandOptionType.String,
            required: true
        },
        {
            name: "kategori",
            description: "Kategori produk buat multi-channel (misal: RDP, Armor). Kosongkan = ALL",
            type: ApplicationCommandOptionType.String,
            required: false
        },
    ],
    /** 
     * @param {Client} client 
     * @param {CommandInteraction} interaction
     * @param {String[]} args 
     */
    run: async (client, interaction, args) => {
        const code = interaction.options.getString("code");
        const productName = interaction.options.getString("name");
        const typeName = interaction.options.getString("type");
        const kategoriInput = interaction.options.getString("kategori");
        const kategori = kategoriInput ? kategoriInput.trim() : "ALL";
        const Role = interaction.options.getRole("role");
        const userars = await client.users.fetch(Owner);

        const getCode = await list
            .findOne({ code: code })
            .then((res) => {
                return res;
            })
            .catch(console.error);

        if (getCode) return interaction.reply({
            content: `Code Has Been Used`,
            ephemeral: true
        });

        if (typeName) {
            if (typeName.includes("script") || typeName.includes("yes")) {
                await new list({
                    code: code,
                    name: productName,
                    type: typeName,
                    role: Role.id,
                    kategori: kategori,
                })
                    .save()
                    .then(async (d) => {
                        await interaction.reply({
                            content: `Product Was Added`,
                            ephemeral: true
                        });
                    })
                    .catch((e) => console.error(e));

                const sendToOwner = new EmbedBuilder()
                    .setTitle("Adding Product History")
                    .setDescription(
                        `
            Code: ${code}
            Name: ${productName}
            Type: ${typeName}
            Kategori: ${kategori}
            Role: ${Role}
        `.replace(/ {2,}/g, "")
                    )
                    .setTimestamp();
                userars.send({ embeds: [sendToOwner] });
            } else {
                let embed = new EmbedBuilder()
                    .setTitle("TYPE OPTION WRITE")
                    .setDescription("- Type **yes**: For sell cid/shock5/rdp/vpn/etc\n- Type **script**: Only for sell script or stock cant delete!");

                await interaction.reply({
                    embeds: [embed],
                    ephemeral: true
                });
            }
        }
    }
}
