let {
    EmbedBuilder,
    escapeMarkdown,
    ApplicationCommandOptionType,
} = require("discord.js");
let list = require("../../Schema/list.js");
let shop = require("../../Schema/shop.js");
let setchannel = require("../../Schema/SettingChannel.js");
let path = require("path");
let { Loading, Benar, Salah } = require("../../config/configemoji.json");
const { connection } = require("mongoose");
const { collection, storefrontBannerUrl } = require("../../config/storefront");

console.log("[VERSION CHECK] addStock.js versi FIXED (deferReply di awal) berhasil dimuat.");

const FETCH_TIMEOUT_MS = 15 * 1000; // batas waktu ambil file dari Discord CDN

// fetch() dengan timeout, biar kalau CDN lemot/gagal, GAGAL dalam beberapa detik, bukan hang selamanya
async function fetchTextWithTimeout(url, timeoutMs = FETCH_TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) throw new Error(`Gagal download file (status ${res.status})`);
        return await res.text();
    } catch (err) {
        if (err.name === "AbortError") {
            throw new Error(`Timeout saat download file (lebih dari ${timeoutMs / 1000} detik)`);
        }
        throw err;
    } finally {
        clearTimeout(timer);
    }
}

async function saveStockItems(code, items) {
    let added = 0;
    for (const data of items) {
        try {
            await new shop({ code, data }).save();
            added++;
        } catch (error) {
            console.error(error);
        }
    }
    return added;
}

// Kirim notifikasi restock ke channel yang sudah di-set lewat /setrestockchannel
async function sendRestockNotif(client, guildId, productName, added, tag) {
    if (!added) return;
    try {
        const channelData = await setchannel.findOne({}).catch(() => null);
        if (!channelData?.ChannelRestock) return;

        const channel = await client.channels.fetch(channelData.ChannelRestock).catch(() => null);
        if (!channel || channel.guildId !== guildId) return;

        const storefront = await connection.collection(collection).findOne({ _id: guildId }).catch(() => null);
        const embed = new EmbedBuilder()
            .setTitle("✅ Restock Notification")
            .setDescription(`· Product: **${escapeMarkdown(productName)}** 🎁\n· Added QTY: **x ${added}** 🟢`)
            .setColor(0x39e914)
            .setImage(storefrontBannerUrl(storefront))
            .setTimestamp();

        await channel.send({
            content: tag ? `${tag}` : undefined,
            embeds: [embed],
            allowedMentions: tag ? { parse: ["roles", "users"] } : { parse: [] },
        }).catch(console.error);
    } catch (e) {
        console.error(e);
    }
}

module.exports = {
    name: 'addstock',
    description: "add Stock For Stock",
    accessableby: "admin",
    options: [
        {
            name: "code",
            description: "What Code For Add Stock?",
            type: ApplicationCommandOptionType.String,
            required: true
        },
        {
            name: "item",
            description: "Write Data",
            type: ApplicationCommandOptionType.String,
            required: false
        },
        {
            name: "file",
            description: "Upload Your file",
            type: ApplicationCommandOptionType.Attachment,
            required: false
        },
        {
            name: "tag",
            description: "Role/user yang mau di-tag di notifikasi restock (kosongkan jika tidak perlu)",
            type: ApplicationCommandOptionType.Mentionable,
            required: false
        }
    ],
    /** 
     * @param {Client} client 
     * @param {CommandInteraction} interaction
     * @param {String[]} args 
     */
    run: async (client, interaction, args) => {
        let itemo = interaction.options.getString("item");
        let filo = interaction.options.getAttachment("file");
        let code = interaction.options.getString("code");
        let tag = interaction.options.getMentionable("tag");

        // Validasi ringan yang gak butuh DB dulu, biar cepat kalau memang salah input
        if (filo && itemo) {
            return interaction.reply({
                content: `Pilih Salah Satu Options Saja!`,
                ephemeral: true
            });
        }

        if (filo) {
            let getf = path.extname(filo.name);
            let sal = [".txt", ".lua", ".js"];
            if (!sal.includes(getf)) {
                return interaction.reply({
                    content: `**Error!!!\nYour File Is: ${getf}\nOnly file .txt or .lua or .js Can add For It!** ${Salah}`,
                    ephemeral: true
                });
            }
        }

        // ACK ke Discord SECEPAT MUNGKIN (sebelum query DB / fetch file), supaya command
        // gak pernah dianggap "gagal" / stuck walau DB atau CDN sedang lambat.
        await interaction.deferReply({ ephemeral: true });

        try {
            let getCode = await list.findOne({ code }).catch(console.error);

            if (!getCode) {
                return interaction.editReply({ content: `Wrong Code` });
            }

            let typo = getCode.type;

            if (!filo && !itemo) {
                return interaction.editReply({
                    content: "**Error!!!\nNot Have Item Or File In Your Send!** " + Salah,
                });
            }

            await interaction.editReply({
                content: `**Proccessing Your Data Into Database** ${Loading}`,
            });

            if (filo) {
                const body = await fetchTextWithTimeout(filo.url);

                if (typo?.includes("script")) {
                    await new shop({ code, data: body }).save();

                    await interaction.followUp({
                        content: `Successfully Added Script Into Database ${Benar}`,
                        ephemeral: true
                    });

                    sendRestockNotif(client, interaction.guildId, getCode.name || code, 1, tag);
                } else {
                    let items = body.split(/[\n\r\s]+/).filter((i) => i.length > 0);

                    if (items.length === 0) {
                        return interaction.followUp({ content: `No Item In This File!`, ephemeral: true });
                    }

                    const added = await saveStockItems(code, items);

                    await interaction.followUp({
                        content: added === items.length
                            ? `Write File Succesffully And Added Into the database! ${Benar}`
                            : `Stok ditambahkan: ${added}/${items.length}`,
                        ephemeral: true
                    });

                    sendRestockNotif(client, interaction.guildId, getCode.name || code, added, tag);
                }
            } else {
                let items = itemo.split(/\s+/).filter((i) => i.length > 0);

                const added = await saveStockItems(code, items);

                await interaction.followUp({
                    content: added === items.length
                        ? `The All Item Has Been Added Into Database ${Benar}`
                        : `Stok ditambahkan: ${added}/${items.length}`,
                    ephemeral: true
                });

                sendRestockNotif(client, interaction.guildId, getCode.name || code, added, tag);
            }
        } catch (error) {
            console.error("addstock error:", error);
            await interaction.followUp({
                content: `Ada Yang Salah! (${error.message})`,
                ephemeral: true
            }).catch(() => {});
        }
    }
};
