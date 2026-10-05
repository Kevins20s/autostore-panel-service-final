const {
    Client,
    CommandInteraction,
} = require("discord.js");
let order = require("../../Schema/orderproduct.js");

module.exports = {
    name: 'resetcount',
    description: "Reset Your Count Testimoni!",
    accessableby: "admin",
    /** 
     * @param {Client} client 
     * @param {CommandInteraction} interaction
     * @param {String[]} args 
     */
    run: async (client, interaction, args) => {
        let ort = await order
            .findOne({})
            .then((d) => {
                return d?.Order;
            })
            .catch((e) => console.error(e));

        if (ort < 1) return interaction.reply({
            content:"Testimoni Already Reset",
            ephemeral: true
        });

        await order
            .findOneAndUpdate(
                {},
                { $set: { Order: 0 } },
                { upsert: true, new: true }
            )
            .then((d) => {
                interaction.reply({
                    content:"Testimoni Has Been Reset",
                    ephemeral: true
                });
            })
            .catch(console.error);
    }
}