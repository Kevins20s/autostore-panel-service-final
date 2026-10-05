const {
    EmbedBuilder,
    Client,
    CommandInteraction,
    ApplicationCommandOptionType,
} = require("discord.js");
let Bal = require("../../Schema/balance.js");
let { WL } = require("../../config/configemoji.json");
const { Owner, Admin } = require("../../config/config.json");
module.exports = {
    name: 'addbalance',
    description: "Check Balance User",
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
        // Defer dulu paling awal, sebelum ada await lain (fetch user / query DB).
        // Ini yang bikin Discord gak keburu timeout ("The application did not respond")
        // kalau MongoDB atau Discord API lagi lambat merespons.
        await interaction.deferReply();

        let user = interaction.options.getUser("user");
        let Balance = interaction.options.getNumber("balance");
        let userid = user.id;
        let userars = await client.users.fetch(Owner);

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

        await Bal.updateOne({ DiscordID: userid }, { $inc: { Balance: Balance, Deposit: Balance } });

        await interaction.editReply({
            content: `${Balance} **World Locks** ${WL} added To <@${userid}>`
        });

        const sendToOwner = new EmbedBuilder()
            .setTitle("Adding Balance History")
            .setDescription(
                `
         User: <@${wallet1.DiscordID}>
         Amount: ${Balance}
       `.replace(/ {2,}/g, "")
            )
            .setTimestamp();
        userars.send({ embeds: [sendToOwner] }).catch((e) => console.error(e));
    }
}
