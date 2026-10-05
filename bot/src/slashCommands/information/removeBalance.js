const {
    EmbedBuilder,
    Client,
    CommandInteraction,
    ApplicationCommandOptionType,
} = require("discord.js");
let Bal = require("../../Schema/balance.js");
const { Owner, Admin } = require("../../config/config.json");
module.exports = {
    name: 'removebalance',
    description: "remove Balance User",
    accessableby: "admin",
    options: [
        {
            name: "user",
            description: "User To Check Balance And GrowID",
            type: ApplicationCommandOptionType.User,
            required: true
        },
        {
            name: "balance",
            description: "How many balance to add?",
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
        // Sama seperti addbalance: defer paling awal biar Discord gak timeout
        // ("The application did not respond") saat nunggu fetch user / query DB.
        await interaction.deferReply({ ephemeral: true });

        let user = interaction.options.getUser("user");
        let userid = user.id;
        let userars = await client.users.fetch(Owner);

        let Balance = interaction.options.getNumber("balance");
        let wallet1 = await Bal.findOne({ DiscordID: userid })
            .then((d) => {
                return d;
            })
            .catch((e) => console.error(e));

        if (!wallet1) return interaction.editReply({
            content: "The user with the tagged user was not **Set Growid** right now"
        });

        if (Balance < 1) return interaction.editReply({
            content: "Use a Positif Number"
        });

        await Bal.updateOne({ DiscordID: userid }, { $inc: { Balance: -Balance, Deposit: Balance } });

        await interaction.editReply({ content: `${Balance} Balance Removed To <@${userid}>` });

        const sendToOwner = new EmbedBuilder()
            .setTitle("Removed Balance History")
            .setDescription(
                `
         User: <@${wallet1.DiscordID}>
         Amount: -${Balance}
       `.replace(/ {2,}/g, "")
            )
            .setTimestamp();
        userars.send({ embeds: [sendToOwner] }).catch((e) => console.error(e));
    }
}
