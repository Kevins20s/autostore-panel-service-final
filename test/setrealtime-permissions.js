"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

async function main() {
    const flags = { ViewChannel: 1024n, SendMessages: 2048n, EmbedLinks: 16384n, ReadMessageHistory: 65536n, SendMessagesInThreads: 274877906944n };
    const writes = [];
    let failSave = false;
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../bot/src/slashCommands/information/setrealtime.js"), "utf8"), {
        module, console,
        require(id) {
            if (id === "discord.js") return { ApplicationCommandOptionType: { Channel: 7, String: 3 }, PermissionFlagsBits: flags };
            if (id === "../../config/config.json") return {};
            if (id === "../../Schema/RealtimeChannel.js") return { findOneAndUpdate: async (...args) => {
                if (failSave) throw new Error("Database unavailable");
                writes.push(args);
            } };
            throw new Error("Unexpected import " + id);
        },
    });
    let permissions = new Set(Object.values(flags));
    let sends = 0, deleted = 0, sendError;
    const channel = {
        id: "channel", guildId: "guild", isTextBased: () => true, isThread: () => false,
        permissionsFor: () => ({ has: flag => permissions.has(flag) }),
        toString: () => "<#channel>",
        send: async () => { sends++; if (sendError) throw sendError; return { id: "message", delete: async () => { deleted++; } }; },
    };
    let reply, deferred;
    const interaction = {
        guildId: "guild", guild: { members: { me: {} } },
        options: { getChannel: () => channel, getString: () => " script " },
        deferReply: async options => { deferred = options; },
        editReply: async value => { reply = value.content; },
    };
    const run = () => module.exports.run(null, interaction);
    permissions.delete(flags.SendMessages);
    await run();
    assert.match(reply, /Kirim Pesan/);
    assert.equal(sends, 0);
    assert.equal(writes.length, 0);
    assert.equal(deferred.ephemeral, true);
    permissions = new Set(Object.values(flags));
    permissions.delete(flags.EmbedLinks);
    await run();
    assert.match(reply, /Embed Links/);
    assert.equal(sends, 0);
    permissions.add(flags.EmbedLinks);
    await run();
    assert.equal(sends, 1);
    assert.equal(writes.length, 1);
    assert.equal(writes[0][0].kategori, "script");
    assert.equal(writes[0][1].$set.messageId, "message");
    assert.equal(writes[0][1].$unset.intervalSeconds, "");
    assert.match(reply, /Successfully Set/);
    sendError = Object.assign(new Error("Missing Permissions"), { code: 50013 });
    await run();
    assert.match(reply, /Discord menolak akses/);
    assert.equal(writes.length, 1);
    sendError = null;
    failSave = true;
    await assert.rejects(run(), /Database unavailable/);
    assert.equal(deleted, 1, "failed save removes the new placeholder without changing the existing catalog");
    failSave = false;
    channel.guildId = "other-guild";
    await run();
    assert.match(reply, /server ini/);
    assert.equal(writes.length, 1);
    channel.guildId = "guild";
    channel.isThread = () => true;
    permissions.delete(flags.SendMessagesInThreads);
    await run();
    assert.match(reply, /Kirim Pesan/);
    assert.equal(writes.length, 1);
    console.log("OK: missing channel permissions, valid setup, Discord rejection, failed save cleanup, and cross-server protection");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
