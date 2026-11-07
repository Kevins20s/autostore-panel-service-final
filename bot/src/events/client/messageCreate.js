const { MessageEmbed, EmbedBuilder } = require('discord.js');
const client = require('../../index');
const Bal = require("../../Schema/balance.js");
const channel = require("../../Schema/SettingChannel.js");
const depo = require("../../Schema/deposition.js");
const { WL, DL, BGL } = require("../../config/configemoji.json");
const { creditWorldDeposit } = require("../../utils/hostedWorldDeposit");

module.exports = {
    name: "Catch Of Donation Embeds"
};

client.on("messageCreate", async (message) => {
    if (process.env.HOSTED_PILOT_BINDING) {
        if (process.env.HOSTED_WORLD_DEPOSIT !== "1" || !message.webhookId) return;
        try {
            const settings = await channel.findOne({});
            const result = await creditWorldDeposit(message, settings);
            if (result) {
                const user = await client.users.fetch(result.discordId);
                await user.send(`Deposit world masuk: ${result.amount} WL. Saldo sekarang ${result.balance} WL.`);
            }
        } catch (error) { console.error("[WORLD DEPOSIT]", error.code || error.name); }
        return;
    }
    let donation = await channel
        .findOne({})
        .then((d) => {
            return d?.ChannelDonation;
        })
        .catch(console.error);
    if (donation) {
        if (donation.includes(message.channel.id)) {
            if (message.embeds.length > 0) {
                const description = message.embeds[0].description;

                // Embed tanpa description (misal log QRIS yang pakai fields) bukan format
                // donasi lama, jadi di-skip aja biar gak crash pas coba di-match().
                if (description) {
                const GrowIDs = description.match(/GrowID: (\w+)/);
                const Deposit = description.match(/Amount: (\d+) ([A-Za-z ]+)/);

                if (GrowIDs && Deposit) {
                    const growId = GrowIDs[1];
                    const growIds = growId.toLowerCase();
                    const depo = parseInt(Deposit[1]);
                    const item = Deposit[2].trim().replace(/\s+/g, "");

                    const wallet1 = await Bal.findOne({ GrowID: growIds })
                        .then((d) => {
                            return d;
                        })
                        .catch(console.error);

                    const itemvalue = {
                        "WorldLock": 1,
                        "DiamondLock": 100,
                        "BlueGemLock": 10000,
                    };

                    const Lko = {
                        "WorldLock": WL,
                        "DiamondLock": DL,
                        "BlueGemLock": BGL,
                    };

                    try {
                        if (!wallet1) return message.reply("User Not Register In Database");
                        if (!itemvalue[item]) return message.reply("Unknown Item Name");

                        await Bal.findOneAndUpdate({ GrowID: growIds }, { $inc: { Balance: depo * itemvalue[item], Deposit: depo * itemvalue[item] } });

                        const wallets = await Bal.findOne({ GrowID: growIds })
                            .then((d) => {
                                return d;
                            })
                            .catch(console.error);

                        let userars = await client.users.fetch(wallets.DiscordID);
                        userars.send({
                            embeds: [
                                {
                                    description: `- Your Has Been Deposit For **${depo} ${Lko[item]}**\n- Now You Have **${wallets.Balance}** ${WL}`,
                                }
                            ]
                        });

                        await message.reply(`Successfully Adding **${depo} ${Lko[item]}** to **${growId}**\nYour **${growId}** Have **${wallets.Balance}** ${WL}`);
                    } catch (error) {
                        message.reply("Error!");
                        console.error("erorr", error);
                    }
                }
                } // tutup if (description)
            }
        }
    }

    let prefix = ["."];
    let prefixs = prefix.some(prik => message.content.startsWith(prik));
    if (prefixs) {
        let rate = await channel
            .findOne({})
            .then((d) => {
                return d?.ChannelStock
            })
            .catch(console.error);

        message.reply({
            embeds: [{
                description: `**Use Button in here** ${rate ? `<#${rate}>` : "Not Set Yet"}`,
            }],
        });
    }

    if (message.content.startsWith("status")) {
        const args = message.content.slice('status'.length).trim().split(/ +/);
        const name = args[0];
        const status = args[1];
        const reason = args[2];

        const upo = await depo
            .findOne({})
            .then((d) => {
                return d;
            })
            .catch(console.error);

        if (name && status) {
            if (!status.includes(upo.status) || !name.includes(upo.botName)) {
                await depo.findOneAndUpdate(
                    {},
                    { $set: { botName: name, status: status, reason: reason } },
                    { upsert: true, new: true }
                )
                .then(async (res) => {
                    console.log(res);
                })
                .catch((e) => console.error(e));
            }
        }
    }
})
