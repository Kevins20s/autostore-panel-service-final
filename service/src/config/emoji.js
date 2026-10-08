const defaults = {
  "WL": "<:wl:1529298716882894858>",
  "DL": "<:DL:1515969948181200996>",
  "BGL": "<:BGL:1515969906791677993>",
  "CROWN": "<a:crown_crown:1529296775716933912>",
  "ARROW": "<a:arrowwhite:1529296230096834751>",
  "EARTH": "<a:earth:1529297412567334943>",
  "BOT": "<:growtopian:1529297593505546342>",
  "Dolar": "<:dollars:1529297687508291634>",
  "BALANCE": "<a:balance:1529297049273635017>",
  "Warning": "<a:warn:1529296379917242368>",
  "Benar": "<a:benar:1529297918870163476>",
  "Salah": "<a:salah:1529297993189298317>",
  "Megaphone": "<:Broadcast:1529298273654018160>",
  "Loading": "<a:loading:1529298132058374164>",
  "Buy": "<:buy:1529298543175667803>",
  "SetGrowID": "<a:SHRules:1269199498320809996>",
  "BalanceButton": "<a:uang:1269199494063456256>",
  "Deposit": "<a:planet2:1269199500673683466>",
  "DepositQRIS": "💳",
  "AdminPanel": "🛠️",
  "Queue": "<:script:1547433220314894346>",
  "Waiting": "⏳",
  "imageUrl": "https://cdn.discordapp.com/attachments/1529290611860181214/1529314355454152764/standard_1.gif?ex=6a617c7b&is=6a602afb&hm=1398b5d3d6c8ca2fe01385cb611c299b5478bf041cf181a3606c80ffff36ca2a&",
  "imageUrl2": "https://cdn.discordapp.com/attachments/1529290611860181214/1529314355454152764/standard_1.gif?ex=6a617c7b&is=6a602afb&hm=1398b5d3d6c8ca2fe01385cb611c299b5478bf041cf181a3606c80ffff36ca2a&",
  "COLOR": "#00FFFF"
};

let custom = {};
try {
  if (process.env.SERVICE_EMOJIS_JSON) custom = JSON.parse(process.env.SERVICE_EMOJIS_JSON) || {};
} catch (e) {
  console.error("[SERVICE] SERVICE_EMOJIS_JSON tidak valid:", e.message);
}

const emoji = { ...defaults, ...custom };

console.log("[SERVICE EMOJI] Loaded:", {
  WL: emoji.WL,
  DL: emoji.DL,
  BGL: emoji.BGL,
  CROWN: emoji.CROWN,
  ARROW: emoji.ARROW,
  Buy: emoji.Buy,
  SetGrowID: emoji.SetGrowID,
  BalanceButton: emoji.BalanceButton,
  Deposit: emoji.Deposit
});
module.exports = emoji;
module.exports.defaults = defaults;
