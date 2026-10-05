const {
    EmbedBuilder,
    Client,
    CommandInteraction,
    ApplicationCommandOptionType,
} = require("discord.js");
let { Owner, serverId } = require("../../config/config.json");
let { Warning, WL, ARROW, Loading, Benar, imageUrl, COLOR } = require("../../config/configemoji.json");
let shop = require("../../Schema/shop.js");
let list = require("../../Schema/list.js");
let Price = require("../../Schema/priceproduct.js");
let order = require("../../Schema/orderproduct.js");
let { MessageEmbed } = require("discord.js");
let ctesti = require("../../Schema/SettingChannel.js");

module.exports = {
    name: 'send',
    description: "sending item product",
    accessableby: "admin",
    options: [
        {
            name: "user",
            description: "Tag User Do You Want To Send Product!",
            type: ApplicationCommandOptionType.User,
            required: true
        },
        {
            name: "code",
            description: "Code Of Product",
            type: ApplicationCommandOptionType.String,
            required: true
        },
        {
            name: "amount",
            description: "Howmuch Do You Want To Sell?",
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
        let item = interaction.options.getString("code");
        let howmuch = interaction.options.getNumber("amount");
        let usertosend = interaction.options.getUser("user");
        let usertosender = usertosend.id;
        let user = interaction.user;
        let userars = await client.users.fetch(Owner);
        let usertosends = await client.users.fetch(usertosender);
        let member = interaction.guild.members.cache.get(usertosender);

        let chaneltesti = await ctesti
            .findOne({})
            .then((d) => {
                return d.ChanelTesti;
            })
            .catch((e) => console.error(e));

        if (!chaneltesti) return interaction.reply({
            content: "Channel Testimoni Not Set Now!!!!",
            ephemeral: true,
        });

        let getCode = await list
            .findOne({ code: item })
            .then((res) => {
                return res;
            })
            .catch(console.error);

        if (!getCode) return interaction.reply({
            content: "Code Not Found",
            ephemeral: true
        });

        if (howmuch < 1) return interaction.reply({
            content: "Use a Valid Number!",
            ephemeral: true,
        });

        let prices = await Price.findOne({ code: item })
            .then((d) => {
                return d?.price;
            })
            .catch((e) => console.error(e));

        if (!prices) return interaction.reply({
            content: "Set Price First For " + item,
            ephemeral: true,
        });

        let data = await shop
            .find({ code: item })
            .then((res) => {
                return res;
            })
            .catch(console.error);

        if (data.length == 0)
            return interaction.reply({
                content: "No Stock Yet",
                ephemeral: true,
            });

        if (Number(data.length) < Number(howmuch))
            return interaction.reply({
                content: "Not That Much Stock",
                ephemeral: true,
            });

        let sending = "";
        await interaction.reply({
            content: "Processing To Send Your Costumers " + Loading,
            ephemeral: true,
        });
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
        try {
            let itemName = await list
                .findOne({ code: item })
                .then((res) => {
                    return res?.name;
                })
                .catch(console.error);

            let doneBuy = new EmbedBuilder()
                .setTitle(`${Warning} Sending Item Successfull ${Warning}`)
                .setDescription(
                    `${ARROW} Sender: <@${interaction.user.id}>\n` +
                    `${ARROW} Buyer: <@${usertosender}>\n` +
                    `${ARROW} Product: **${itemName}**\n` +
                    `${ARROW} Code: **${item}**\n` +
                    `${ARROW} Total: **${howmuch}**\n`
                )
                .setTimestamp()
                .setFooter({
                    text: `No Reps , No Waranty`,
                    iconURL: client.user.displayAvatarURL({ dynamic: true }),
                });

            usertosends.send({
                content: `This Is ${usertosend} Order\n# NO REPS NO WARRANTY`,
                files: [
                    {
                        attachment: Buffer.from(sending),
                        name: `${usertosend.username} Order.txt`,
                    },
                ],
                embeds: [doneBuy],
            });

            userars.send({
                content: "This Is <@" + usertosender + "> Order",
                files: [
                    {
                        attachment: Buffer.from(sending),
                        name: `${usertosend.username} Order.txt`,
                    },
                ],
            });

            let responsbuy = new EmbedBuilder()
                .setDescription(
                    `${Warning} **Sending Item Success** ${Warning}\n` +
                    `**${ARROW} ${usertosend} Adding New Role : BUYER** ${Benar}\n` +
                    `**${ARROW} Status : Success** ${Benar}\n` +
                    `**${interaction.user.username} Please Check Our Direct Message!**`
                );

            let responsbuys = new EmbedBuilder()
                .setDescription(
                    `${Warning} **Sending Item Success** ${Warning}\n` +
                    `**${ARROW} ${usertosend} Already Have Role : BUYER** ${Benar}\n` +
                    `**${ARROW} Status : Success** ${Benar}\n` +
                    `**${interaction.user.username} Please Check Our Direct Message!**`
                );

            if (member.roles.cache.some((r) => r.id == getCode.role)) {
                interaction.followUp({
                    embeds: [responsbuys],
                    ephemeral: true,
                });
            } else {
                member.roles.add(getCode.role);
                interaction.followUp({
                    embeds: [responsbuy],
                    ephemeral: true,
                });
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

            let testi = new EmbedBuilder()
                .setTitle("#Order Number: " + orderN)
                .setDescription(`${ARROW} Sender: **<@${usertosender}>**\n${ARROW} Buyer: **<@${user.id}>**\n${ARROW} Product: **${itemName}**\n${ARROW} Jumlah: **${howmuch}**\n\n**Thanks You For Purchasing Our Product** ${Benar}`)
                .setColor(COLOR)
                .setTimestamp()
                .setImage(imageUrl);

            let ch = interaction.guild.channels.cache.get(chaneltesti);
            await ch.send({ embeds: [testi]})
        } catch (erorr) {
            interaction.followUp({
                content:"ADA ERROR!",
                ephemeral: true
            });

            userars.send({
                content: "This Is <@" + usertosender + "> Order",
                files: [
                    {
                        attachment: Buffer.from(sending),
                        name: `${usertosend.username} Order.txt`,
                    },
                ],
            });
        }
    }
}