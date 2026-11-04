]let { Owner, Admin, serverId } = require("../../config/config.json");
let {
    InteractionType,
    ButtonStyle,
    ActionRowBuilder,
    EmbedBuilder,
    ButtonBuilder,
    Embed,
} = require("discord.js");
let { Warning, Benar, WL, ARROW, Loading, COLOR, CROWN, Dolar, Buy, BALANCE, imageUrl } = require("../../config/configemoji.json");
let Bal = require("../../Schema/balance.js");
let shop = require("../../Schema/shop.js");
let list = require("../../Schema/list.js");
let Price = require("../../Schema/priceproduct.js");
let order = require("../../Schema/orderproduct.js");
let orderLog = require("../../Schema/orderlog.js");
let mt = require("../../Schema/maintenance.js");
let { MessageEmbed } = require("discord.js");
let ctesti = require("../../Schema/SettingChannel.js");
let client = require('../../index.js');
let disc = require("../../Schema/discount.js");
let bulk = require("../../Schema/bulkdiscount.js");

module.exports = {
    name: "Buying Item Of Menu"
};

client.on("interactionCreate", async (interaction) => {
    if (interaction.customId && (interaction.customId === "buys" || interaction.customId.startsWith("buysamount::"))) {
        if (interaction.type !== InteractionType.ModalSubmit) return;
        let howmuch = interaction.fields.getTextInputValue("jumlah");
        let item = interaction.customId.startsWith("buysamount::")
            ? interaction.customId.split("::")[1]
            : interaction.fields.getTextInputValue("code");

        let chaneltesti = await ctesti
            .findOne({})
            .then((d) => {
                return d.ChanelTesti;
            })
            .catch((e) => console.error(e));

        if (!chaneltesti) return interaction
            .reply({
                content: "Channel Testimoni Not Set Now!!!!",
                ephemeral: true
            })
            .catch(console.error);

        let getCode = await list
            .findOne({ code: item })
            .then((res) => {
                return res;
            })
            .catch(console.error);

        let saf = await disc
            .findOne({ code: item })
            .then((d) => {
                return d;
            })
            .catch(console.error);

        if (!getCode) return interaction
            .reply({
                content: "Code Not Found",
                ephemeral: true
            })
            .catch(console.error);

        if (howmuch < 1) return interaction
            .reply({
                content: "Use a positif Number!",
                ephemeral: true
            })
            .catch(console.error);

        if (isNaN(howmuch)) return interaction
            .reply({
                content: "Only Use Number For Amount",
                ephemeral: true
            })
            .catch(console.error);

        let user = interaction.user;
        let userars = await client.users.fetch(Owner);

        // Kirim notifikasi order yang sama ke Owner + semua Admin (config.json -> "Admin": [...])
        async function notifyStaff(payload) {
            await userars.send(payload).catch((err) => console.error("Gagal DM Owner:", err.message));

            for (const adminId of Admin || []) {
                if (adminId === Owner) continue; // hindari kirim dobel kalau Owner juga ada di list Admin
                try {
                    const adminUser = await client.users.fetch(adminId);
                    await adminUser.send(payload);
                } catch (err) {
                    console.error(`Gagal DM Admin (${adminId}):`, err.message);
                }
            }
        }
        let member = interaction.guild.members.cache.get(user.id);
        let channeltestimoni = interaction.guild.channels.cache.get(chaneltesti);

        let getBal = await Bal.findOne({ DiscordID: user.id })
            .then((d) => {
                return d;
            })
            .catch((e) => console.error(e));

        if (!getBal) return interaction
            .reply({
                content: "**Set Growid** First Before Using This Button!",
                ephemeral: true
            })
            .catch(console.error);

        let price = await Price.findOne({ code: item })
            .then((d) => {
                return d?.price;
            })
            .catch((e) => console.error(e));

        if (!price) return interaction
            .reply({
                content: "Tag Owner To Set Price For " + item,
                ephemeral: true
            })
            .catch(console.error);

        let data = await shop
            .find({ code: item })
            .then((res) => {
                return res;
            })
            .catch(console.error);

        if (data.length == 0) return interaction
            .reply({
                content: "No Stock Yet",
                ephemeral: true
            })
            .catch(console.error);

        if (Number(data.length) < Number(howmuch)) return interaction
            .reply({
                content: "Not That Much Stock",
                ephemeral: true
            })
            .catch(console.error);

        // Cari tingkatan bulk discount (potongan per unit berdasarkan jumlah beli)
        let bulkTiers = await bulk
            .find({ code: item })
            .then((res) => res)
            .catch(console.error) || [];

        let bestTier = bulkTiers
            .filter((t) => Number(howmuch) >= Number(t.minQty))
            .sort((a, b) => Number(b.minQty) - Number(a.minQty))[0];

        let bulkCut = bestTier ? Number(bestTier.cut) : 0;
        let unitPrice = Number(price) - bulkCut;
        if (unitPrice < 0) unitPrice = 0;

        let prico = Number(unitPrice) * Number(howmuch);
        let discount = saf?.discount;
        let discountprice = unitPrice * discount;
        let total = unitPrice - discountprice;
        let pricos = Number(total) * Number(howmuch);

        if (saf) {
            if (getBal.Balance < pricos) return interaction
                .reply({
                    content: "Ur Money Is Less, The Price Is " + pricos,
                    ephemeral: true
                })
                .catch(console.error);
        } else {
            if (getBal.Balance < prico) return interaction
                .reply({
                    content: "Ur Money Is Less, The Price Is " + prico,
                    ephemeral: true
                })
                .catch(console.error);
        }

        let orderN = await order
            .findOneAndUpdate(
                {},
                { $inc: { Order: 1 } },
                { upsert: true, new: true }
            )
            .then((d) => {
                return d?.Order;
            })
            .catch(console.error);

        if (!orderN) orderN = 1;

        let testis = new EmbedBuilder()
            .setTitle("#Order Number: " + orderN)
            .setDescription(`${ARROW} Buyer: **<@${user.id}>**\n${ARROW} Product: **${getCode?.name}**\n${ARROW} Quantity: **${howmuch}**\n${ARROW} Total Price:** ~~${parseFloat(prico).toFixed(1)}~~ ${pricos} ${WL}**\n\n**Thanks For Purchasing Our Product** ${Benar}`)
            .setColor(COLOR)
            .setTimestamp()
            .setImage(imageUrl);

        let testi = new EmbedBuilder()
            .setTitle("#Order Number: " + orderN)
            .setDescription(`${ARROW} Buyer: **<@${user.id}>**\n${ARROW} Product: **${getCode?.name}**\n${ARROW} Quantity: **${howmuch}**\n${ARROW} Total Price: **${parseFloat(prico).toFixed(1)}** ${WL}\n\n**Thanks For Purchasing Our Product** ${Benar}`)
            .setColor(COLOR)
            .setTimestamp()
            .setImage(imageUrl);

        await interaction
            .reply({
                content: `**Processing Your Order** ${Loading}`,
                ephemeral: true
            })
            .catch(console.error);

        let sending = "";
        if (!getCode.type.includes("script")) {
            for (let i = 0; i < howmuch; i++) {
                let send = await shop
                    .findOneAndDelete({ code: item })
                    .then((res) => {
                        return res;
                    })
                    .catch(console.error);
                sending += send.data + "\n";
            }
        } else {
            let send = await shop
                .findOne({ code: item })
                .then((res) => {
                    return res;
                })
                .catch(console.error);
            sending += send.data;
        }

        // Update jumlah "Sold" produk ini (dihitung begitu stok sudah diambil dari database)
        await list.updateOne({ code: item }, { $inc: { sold: Number(howmuch) } }).catch(console.error);

        // Catat riwayat order untuk halaman Orders & grafik di panel web. Kegagalan di sini tidak boleh mengganggu pembelian.
        try {
            const charged = getCode.type.includes("script") ? Number(price) : (saf ? Number(pricos) : Number(prico));
            await orderLog.create({
                orderNumber: orderN, discordId: user.id, growId: getBal?.GrowIDNow || getBal?.GrowID || "",
                code: item, productName: getCode?.name || item, qty: Number(howmuch), total: charged,
            });
        } catch (e) { console.error("[ORDERLOG]", e.message); }

        try {
            if (!member.roles.cache.some((r) => r.id == getCode?.role)) {
                member.roles.add(getCode.role);
            }

            if (getCode.type.includes("script")) {
                await Bal.updateOne(
                    { DiscordID: user.id },
                    { $inc: { Balance: -Number(price) } }
                );
            } else {
                if (saf) {
                    await Bal.updateOne(
                        { DiscordID: user.id },
                        { $inc: { Balance: -Number(pricos) } }
                    );
                } else {
                    await Bal.updateOne(
                        { DiscordID: user.id },
                        { $inc: { Balance: -Number(prico) } }
                    );
                }
            }

            let sam = '```\n' + sending + '\n```';
            let getBalo = await Bal.findOne({ DiscordID: user.id })
                .then((d) => {
                    return d?.Balance;
                })
                .catch((e) => console.error(e));

            let embeda = new EmbedBuilder()
            .setTitle(`${CROWN} Purchase Details ${CROWN}`)
            .setDescription(`**•━❪${Benar}❫━•Status: ` + "```Success```**" + `\n**•━❪${Dolar}❫━• Price:** ${WL}` + "**```" + `${parseFloat(prico).toFixed(1)} ` + "```**" + `\n**•━❪${BALANCE}❫━• Balance:** ${WL}` + "**```" + `${parseFloat(getBalo).toFixed(1)}` + "```**" + "\n**Thank You For Pruchasing!**")
            .setTimestamp()
            .setColor(COLOR)
            .setFooter({
                text: `Check your message!`,
                iconURL: interaction.user.displayAvatarURL({ dynamic: true }),
            });

            let embedo = new EmbedBuilder()
                .setTitle(`${CROWN} Purchase Details ${CROWN}`)
                .setDescription(`**•━❪${Buy}❫━• Product: __${getCode?.name}__**\n**•━❪${Buy}❫━• Amount: __${howmuch}__**\n**•━❪${Dolar}❫━• Price:** ${parseFloat(prico).toFixed(1)} ${WL}\n\n${Warning} **This Ur Order** ${Warning}\n${sam}\n**Thanks You For Pruchasing!** ${Benar}`)
                .setTimestamp()
                .setColor(COLOR)
                .setFooter({
                    text: `${interaction.user.username} Order`,
                    iconURL: interaction.user.displayAvatarURL({ dynamic: true }),
                });

            let embed = new EmbedBuilder()
                .setTitle(`${CROWN} Purchase Details ${CROWN}`)
                .setDescription(`**[${Buy}] Purchase:** ${howmuch} ${getCode?.name}\n**[${BALANCE}] Price:** ${parseFloat(prico).toFixed(1)} ${WL}\n**[${Dolar}] Balance:** ${parseFloat(getBalo).toFixed(1)} ${WL}\n\n${Warning} **This Ur Order** ${Warning}\n${sam}\n**Thanks You For Pruchasing!** ${Benar}`)
                .setTimestamp()
                .setColor(COLOR)
                .setFooter({
                    text: `_ _`,
                    iconURL: interaction.user.displayAvatarURL({ dynamic: true }),
                });

            notifyStaff({
                content: "This Is <@" + interaction.user.id + "> Order",
                files: [
                    {
                        attachment: Buffer.from(sending),
                        name: `${interaction.user.username} Order.txt`,
                    },
                ],
            });

            if (saf) {
                user.send({
                    content: `This Is <@${interaction.user.id}> Order\n# NO REPS NO WARRANTY`,
                    files: [
                        {
                            attachment: Buffer.from(sending),
                            name: `${interaction.user.username}_Order.txt`,
                        },
                    ],
                    embeds: [embedo],
                });

                await interaction.followUp({
                    embeds: [embeda],
                    ephemeral: true
                })
                .catch(console.error);
                await channeltestimoni.send({ embeds: [testis] });
            } else {
                user.send({
                    content: `This Is <@${interaction.user.id}> Order\n# NO REPS NO WARRANTY`,
                    files: [
                        {
                            attachment: Buffer.from(sending),
                            name: `${interaction.user.username}_Order.txt`,
                        },
                    ],
                    embeds: [embedo],
                });

                await interaction.followUp({
                    embeds: [embeda],
                    ephemeral: true
                })
                .catch(console.error);
                await channeltestimoni.send({ embeds: [testi] });
            }
        } catch (erorr) {
            interaction.followUp({
                content: "Dm Owner For Your Order!",
                ephemeral: true
            });

            if (getCode.type.includes("script")) {
                await Bal.updateOne(
                    { DiscordID: user.id },
                    { $inc: { Balance: -Number(price) } }
                );
            } else {
                if (saf) {
                    await Bal.updateOne(
                        { DiscordID: user.id },
                        { $inc: { Balance: -Number(pricos) } }
                    );
                } else {
                    await Bal.updateOne(
                        { DiscordID: user.id },
                        { $inc: { Balance: -Number(prico) } }
                    );
                }
            }

            notifyStaff({
                content: "This Is <@" + interaction.user.id + "> Order",
                files: [
                    {
                        attachment: Buffer.from(sending),
                        name: `${interaction.user.username} Order.txt`,
                    },
                ],
            });
        }
    }
})
