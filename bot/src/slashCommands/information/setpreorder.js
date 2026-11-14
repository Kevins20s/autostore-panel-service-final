"use strict";

const { ApplicationCommandOptionType: T, ChannelType } = require("discord.js");
const { runCommand, safeRun } = require("../../utils/preorderDiscord");

module.exports = {
    name: "setpreorder",
    description: "Pasang panel preorder, daftar pesanan, dan kategori tiket privat",
    accessableby: "everyone",
    options: [
        { name: "channel", description: "Channel untuk tombol dan daftar preorder", type: T.Channel,
            channel_types: [ChannelType.GuildText, ChannelType.GuildAnnouncement], required: true },
        { name: "kategori", description: "Kategori tempat tiket preorder dibuat", type: T.Channel,
            channel_types: [ChannelType.GuildCategory], required: true },
    ],
    run: (client, interaction) => safeRun(interaction, () => runCommand(client, interaction)),
};
