let {
    ModalBuilder,
    TextInputBuilder,
    ActionRowBuilder,
    TextInputStyle,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
} = require("discord.js");
let client = require('../../index');
let mt = require("../../Schema/maintenance.js");
let Bal = require("../../Schema/balance.js");
let list = require("../../Schema/list.js");
const Stock = require("../../Schema/shop.js");
let { serverId } = require("../../config/config.json");
const { interactionEmojis, componentEmoji } = require("../../config/storefront");
let cd = new Map();

module.exports = {
    name: "Button Menu"
};

client.on("interactionCreate", async (interaction) => {
    let growid = new ModalBuilder()
        .setCustomId("growids")
        .setTitle("Set Your GrowID");

    let getgrowid = new TextInputBuilder()
        .setCustomId("growid")
        .setLabel("Input Your Growtopia username:")
        .setStyle(TextInputStyle.Short)
        .setMaxLength(50)
        .setMinLength(2)
        .setPlaceholder("Input Your Growtopia username In Here!")
        .setRequired(true);
    let row3 = new ActionRowBuilder().addComponents(getgrowid);
    growid.addComponents(row3);

    let confirm = new TextInputBuilder()
        .setCustomId("confirm")
        .setLabel("Confirm Your Growtopia username:")
        .setStyle(TextInputStyle.Short)
        .setMaxLength(50)
        .setMinLength(2)
        .setPlaceholder("Confirm username!")
        .setRequired(true);
    let row4 = new ActionRowBuilder().addComponents(confirm);
    growid.addComponents(row4);

    try {
        // ── Pilih produk dari dropdown "Click here to buy products" -> langsung tampilkan modal jumlah ──
        if (interaction.isStringSelectMenu() && interaction.customId === "Howmanys") {
            let getBal = await Bal.findOne({ DiscordID: interaction.user.id }).catch((e) => console.error(e));

            if (interaction.guildId !== serverId) return interaction.reply({
                content: "You can use the button if not a server in config!",
                ephemeral: true
            });

            const code = interaction.values[0];
            if (!code || code === "none" || !await Stock.exists({ code, data: { $type: "string", $ne: "" } })) {
                const emojis = await interactionEmojis(interaction);
                return interaction.reply({ content: `${emojis.outOfStock} Stok produk ini sedang habis.`, ephemeral: true });
            }

            if (!getBal) {
                const emojis = await interactionEmojis(interaction);
                const rowGrowid = new ActionRowBuilder().addComponents(new ButtonBuilder()
                    .setLabel("Set GrowID").setStyle(ButtonStyle.Secondary)
                    .setEmoji(componentEmoji(emojis.growId)).setCustomId("growid23"));
                return interaction.reply({
                    content: "**Set Growid** First Before Using This Button!",
                    components: [rowGrowid],
                    ephemeral: true
                });
            }

            let lcd = cd.get(interaction.guildId);
            if (lcd && Date.now() < lcd) {
                let rt = Math.ceil((lcd - Date.now()) / 40000);
                return interaction.reply({
                    content: `Please wait **${rt} Minutes** before using it again!`,
                    ephemeral: true
                });
            }
            cd.set(interaction.guildId, Date.now() + 40000);

            let userCd = cd.get(`amount_${interaction.user.id}`);
            if (userCd && Date.now() < userCd) {
                let rt = Math.ceil((userCd - Date.now()) / 1000);
                return interaction.reply({
                    content: `Please wait **${rt} seconds** before using it again!`,
                    ephemeral: true
                });
            }
            cd.set(`amount_${interaction.user.id}`, Date.now() + 5000);

            let buyAmount = new ModalBuilder()
                .setCustomId(`buysamount::${code}`)
                .setTitle(`Buy ${code}`);

            let amount = new TextInputBuilder()
                .setCustomId("jumlah")
                .setLabel("Amount")
                .setStyle(TextInputStyle.Short)
                .setMaxLength(4)
                .setMinLength(1)
                .setPlaceholder("Howmany do you want to buy?")
                .setValue("1")
                .setRequired(true);

            buyAmount.addComponents(new ActionRowBuilder().addComponents(amount));
            return interaction.showModal(buyAmount);
        }

        if (interaction.customId === "growid23") {
            let lcd = cd.get(interaction.user.id);
            if (lcd && Date.now() < lcd) {
                let rt = Math.ceil((lcd - Date.now()) / 1000);
                return interaction.reply({
                    content: `Please wait **${rt} seconds** before using it again!`,
                    ephemeral: true
                });
            }

            cd.set(interaction.user.id, Date.now() + 20000)
            await interaction.showModal(growid);
        }
    } catch (error) {
        console.error(error);
        if (!interaction.replied && !interaction.deferred) {
            interaction.reply({
                content: `Error!`,
                ephemeral: true
            }).catch(() => {});
        }
    }
})
