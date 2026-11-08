let {
    InteractionType,
    ButtonStyle,
    ActionRowBuilder,
    EmbedBuilder,
    ButtonBuilder,
} = require("discord.js");
let client = require('../../index');
const { COLOR } = require("../../config/configemoji.json");
let mt = require("../../Schema/maintenance.js");
let Bal = require("../../Schema/balance.js");
let shop = require("../../Schema/shop.js");
let list = require("../../Schema/list.js");
let Price = require("../../Schema/priceproduct.js");
let { MessageEmbed } = require("discord.js");
let depo = require("../../Schema/deposition.js");
let cd = new Map();
const { buttons, models, interactionEmojis, componentEmoji } = require("../../config/storefront");

module.exports = {
    name: "ButtonMessage"
};

client.on("interactionCreate", async (interaction) => {
    if (interaction.customId === "balance1") {
        const { growId: BOT, crown: CROWN, balanceMark: BALANCE, wl: WL, price: Dolar, convert } = await interactionEmojis(interaction, models.classic);
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setLabel("Set GrowID")
                .setStyle(ButtonStyle.Secondary)
                .setEmoji(componentEmoji(BOT))
                .setCustomId("growid23")
        );

        let lcd = cd.get(interaction.user.id);
        if (lcd && Date.now() < lcd) {
            let rt = Math.ceil((lcd - Date.now()) / 1000);
            return interaction.reply({
                content:`Please wait **${rt} seconds** before using it again!`,
                ephemeral: true
            });
        }

        cd.set(interaction.user.id, Date.now() + 20000)

        let wallet1 = await Bal.findOne({ DiscordID: interaction.user.id })
            .then((d) => {
                return d;
            })
            .catch((e) => console.error(e));

        if (!wallet1) return interaction.reply({
            content: "**Set Growid** First Before Use The Button!",
            components: [row],
            ephemeral: true
        });

        let embed = new EmbedBuilder()
            .setTitle(`${CROWN} Balance Information ${CROWN}`)
            .setDescription(
                `> **•━❪${BOT}❫━• GrowID**: ` + ("**```") + (`${wallet1.GrowIDNow}`) + ("```**\n") +
                `> **•━❪${BALANCE}❫━• Balance**:${WL} ` + ("**```") + (`${parseFloat(wallet1.Balance).toFixed(1)}`) + ("```**\n") +
                `> **•━❪${Dolar}❫━• Total Deposit**:${WL} ` + ("**```") + (`${wallet1.Deposit}`) + ("```**")
            )
            .setTimestamp()
            .setColor(COLOR)
            .setFooter({
                text: `This Is Your Balance ${interaction.user.username}`,
                iconURL: interaction.user.displayAvatarURL({ dynamic: true }),
            });

        const components = [];
        if (wallet1.BalanceRp > 0) {
            embed.addFields({ name: "Saldo Rupiah", value: "Rp" + wallet1.BalanceRp.toLocaleString("id-ID") });
            components.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(buttons.convert)
                .setLabel("Convert Rp to WL").setEmoji(componentEmoji(convert)).setStyle(ButtonStyle.Success)));
        }
        await interaction.reply({ embeds: [embed], components, ephemeral: true });
    }

    if (interaction.customId === "deposit") {
        const { growId, bot: BOT, world: EARTH, crown: CROWN } = await interactionEmojis(interaction, models.classic);
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setLabel("Set GrowID")
                .setStyle(ButtonStyle.Secondary)
                .setEmoji(componentEmoji(growId))
                .setCustomId("growid23")
        );

        let lcd = cd.get(interaction.user.id);
        if (lcd && Date.now() < lcd) {
            let rt = Math.ceil((lcd - Date.now()) / 1000);
            return interaction.reply({
                content:`Please wait **${rt} seconds** before using it again!`,
                ephemeral: true
            });
        }

        cd.set(interaction.user.id, Date.now() + 20000)

        let wallet = await Bal.findOne({ DiscordID: interaction.user.id })
            .then((d) => {
                return d;
            })
            .catch((e) => console.error(e));

        if (!wallet) return interaction.reply({
            content: "**Set Growid** First Before Use The Button!",
            components: [row],
            ephemeral: true
        });

        let deposit = await depo
            .findOne({})
            .then((d) => {
                return d;
            })
            .catch((e) => console.error(e));

        let embed = new EmbedBuilder()
            .setTitle(`${CROWN} Deposit World ${CROWN}`)
            .setDescription(
                `> **•━❪${EARTH}❫━• World**: **` + "```" +
                (deposit?.world ? deposit.world : "Not Set Yet") +
                "```**\n" +
                `> **•━❪${CROWN}❫━• Owner**: **` + "```" +
                (deposit?.owner ? deposit.owner : "Not Set Yet") +
                "```**\n" +
                `> **•━❪${BOT}❫━• Bot Name**: **` + "```" +
                (deposit?.botName ? deposit.botName : "Not Set Yet") +
                "```**"
            )
            .setTimestamp()
            .setColor(COLOR)
            .setFooter({
                text: `Don't Donate If Bot Isnt The World`,
                iconURL: interaction.user.displayAvatarURL({ dynamic: true }),
            });

        await interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (interaction.customId === "growids") {
        if (interaction.type !== InteractionType.ModalSubmit) return;
        let id = interaction.fields.getTextInputValue("growid");
        let correct = interaction.fields.getTextInputValue("confirm");

        let GrowID = id.toLowerCase();
        let user = interaction.user.id;

        let checkuser = await Bal
            .findOne({ DiscordID: user })
            .then((d) => {
                return d;
            })
            .catch(console.error);

        if (!correct.includes(id)) return interaction.reply({
            content: "Can You Correctly?",
            ephemeral: true
        });

        let existingEntry = await Bal.findOne({ GrowID: GrowID })
            .then((d) => {
                return d?.DiscordID;
            })
            .catch((e) => console.error(e));

        if (existingEntry && existingEntry !== user) return interaction.reply({
            content: "Sorry, Thats GrowID Has Been Used!",
            ephemeral: true
        });

        if (checkuser) {
            if (checkuser.GrowID === GrowID) return interaction.reply({
                content: `Your GrowID Already **${id}**`,
                ephemeral: true
            });
        }

        await Bal.findOneAndUpdate(
            { DiscordID: user },
            { $set: { GrowID: GrowID, GrowIDNow: id } },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        )
        .then((res) => {
            console.log(res);
            if (checkuser) {
                interaction.reply({
                    embeds: [{
                        description: `Successfully Updated Your GrowID **${checkuser.GrowIDNow}** to **${id}**`,
                    }],
                    ephemeral: true
                });
            } else {
                interaction.reply({
                    embeds: [{
                        description: `**Welcome To Server**\nSuccessfully Set You GrowID to **${id}**`,
                    }],
                    ephemeral: true
                });
            }
        })
        .catch(console.error);
    }

    if (interaction.customId === "status") {
        const emojis = await interactionEmojis(interaction, models.classic);
        let stats = await depo
            .findOne({})
            .then((d) => {
                return d;
            })
            .catch(console.error);

        if (!stats.status) return interaction.reply({
            content:"Status Do Not Set Right Now!",
            ephemeral: true,
        });

        if (stats.status == "Online") {
            await interaction.reply({
                embeds:[
                    {
                        description:`[${emojis.bot}] Name Bot: **${stats?.botName ? stats?.botName : "Not Set Right Now!"}**\n[${emojis.monitor}] Status: **Online ${emojis.online}**`,
                    },
                ],
                ephemeral: true,
            });
        } else if (stats.status == "Offline") {
            await interaction.reply({
                embeds:[
                    {
                        description:`[${emojis.bot}] Name Bot: **${stats?.botName ? stats?.botName : "Not Set Right Now!"}**\n[${emojis.monitor}] Status: **Offline (${stats?.reason ? stats?.reason : "Inposible"})** ${emojis.offline}`,
                    },
                ],
                ephemeral: true,
            });
        }
    }
})
