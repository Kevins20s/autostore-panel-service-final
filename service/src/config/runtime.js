module.exports = {
  TOKEN: process.env.DISCORD_TOKEN || process.env.SERVICE_DISCORD_TOKEN || "",
  MongoURL: process.env.MONGO_URL || process.env.SERVICE_MONGO_URL || "",
  CLIENTID: process.env.CLIENT_ID || process.env.SERVICE_CLIENT_ID || "",
  Owner: process.env.OWNER_ID || process.env.SERVICE_OWNER_ID || "",
  Admin: String(process.env.ADMIN_IDS || process.env.SERVICE_ADMIN_IDS || "").split(",").map(s => s.trim()).filter(Boolean),
  serverId: process.env.GUILD_ID || process.env.SERVICE_GUILD_ID || ""
};
