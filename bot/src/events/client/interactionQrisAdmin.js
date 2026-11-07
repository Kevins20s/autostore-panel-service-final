const client = require("../../index");
const Qris = require("../../Schema/qris.js");
const { creditDeposit, cancelDeposit, fetchDmMessage } = require("../../utils/depositWatcher.js");
const { Owner, Admin, serverId } = require("../../config/config.json");
const { Warning, Benar, Salah } = require("../../config/configemoji.json");
const { cancelHostedQris } = require("../../utils/hostedDepositLogs");
const { readHostedQrCancelId } = require("../../utils/hostedQrCancel");
const hostedBinding = process.env.HOSTED_PILOT_BINDING ? JSON.parse(process.env.HOSTED_PILOT_BINDING) : null;

module.exports = {
    name: "interactionQrisAdmin",
};

function isAdminOrOwner(userId) {
    return userId === Owner || (Array.isArray(Admin) && Admin.includes(userId));
}

client.on("interactionCreate", async (interaction) => {
    if (!interaction.isButton()) return;
    if (interaction.customId.startsWith("qriscancel_")) {
        const orderId = hostedBinding && readHostedQrCancelId(interaction.customId, serverId, hostedBinding.legacy);
        if (!orderId) return;
        await interaction.deferReply({ ephemeral: true });
        const trx = await Qris.findOne({ orderId, discordId: interaction.user.id, panelManaged: true });
        if (!trx) return interaction.editReply("Transaksi tidak ditemukan untuk akunmu.");
        if (trx.status !== "pending") return interaction.editReply("Transaksi sudah diproses.");
        try {
            await cancelHostedQris(trx);
            return interaction.editReply("Permintaan QRIS dibatalkan. Pembayaran yang sudah terlanjur dikirim tetap diproses saat terverifikasi.");
        } catch (error) { return interaction.editReply(error.message); }
    }
    if (
        !interaction.customId.startsWith("qrisadmin_success_") &&
        !interaction.customId.startsWith("qrisadmin_cancel_")
    ) {
        return;
    }

    // Hanya Admin/Owner yang boleh menekan tombol ini
    if (!isAdminOrOwner(interaction.user.id)) {
        return interaction.reply({
            content: `${Warning} Tombol ini cuma bisa dipakai oleh **Admin/Owner**.`,
            ephemeral: true,
        });
    }

    const isSuccess = interaction.customId.startsWith("qrisadmin_success_");
    const orderId = interaction.customId.replace(isSuccess ? "qrisadmin_success_" : "qrisadmin_cancel_", "");

    await interaction.deferReply({ ephemeral: true });

    try {
        const trx = await Qris.findOne({ orderId }).catch(console.error);

        if (!trx) {
            return interaction.editReply({
                content: `${Warning} Transaksi dengan Order ID \`${orderId}\` tidak ditemukan.`,
            });
        }

        if (trx.status !== "pending") {
            return interaction.editReply({
                content: `${Warning} Transaksi ini sudah diproses sebelumnya (status saat ini: **${trx.status}**).`,
            });
        }

        const dmMessage = await fetchDmMessage(trx);
        if (trx.panelManaged) {
            if (isSuccess) return interaction.editReply("QRIS otomatis dikonfirmasi oleh sistem pembayaran.");
            await cancelHostedQris(trx);
            return interaction.editReply(`${Salah} Deposit \`${trx.orderId}\` ditandai **CANCELLED**.`);
        }

        if (isSuccess) {
            const ok = await creditDeposit(trx, dmMessage, interaction.user.id);

            if (!ok) {
                return interaction.editReply({
                    content: `${Warning} Gagal memproses (kemungkinan sudah diproses admin lain barusan).`,
                });
            }

            return interaction.editReply({
                content: `${Benar} Deposit \`${trx.orderId}\` ditandai **SUCCESS**, balance **${trx.wlAmount} WL** sudah ditambahkan ke <@${trx.discordId}>.`,
            });
        } else {
            const ok = await cancelDeposit(trx, dmMessage, interaction.user.id);

            if (!ok) {
                return interaction.editReply({
                    content: `${Warning} Gagal memproses (kemungkinan sudah diproses admin lain barusan).`,
                });
            }

            return interaction.editReply({
                content: `${Salah} Deposit \`${trx.orderId}\` ditandai **CANCELLED**.`,
            });
        }
    } catch (err) {
        console.error("interactionQrisAdmin error:", err);
        return interaction
            .editReply({ content: `${Warning} Terjadi kesalahan: ${err.message}` })
            .catch(() => {});
    }
});
