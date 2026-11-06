local WorldDonation   = ""
local WebhookDonation = ""
local WebhookStatus   = ""
local WebhookStarted  = ""

local UsernameWebhook = ""
local BannerWebhook   = ""
local AvatarWebhook   = ""

local EmojiCrown   = "<a:crown_crown:1529296775716933912>"
local EmojiGrowID  = "<:growtopian:1529297593505546342>"
local EmojiProduct = "<:vend:1515970000630976513>"
local EmojiBalance = "<a:balance:1529297049273635017>"
local EmojiWorld   = "<a:world:1454330612071792683>"
local EmojiMonitor = "<:monitor:1529532071297552603>"
local EmojiClock   = "<a:Clock:1529532158228566158>"
local EmojiOnline  = "<a:_online:1529531966712582154>"
local EmojiOffline = "<a:offline:1529531870000189443>"

local SEPARATOR = "═══════════════"
local bot       = getBot()
local startTime = os.time()

-- STATUS
local status_msg_id      = nil
local last_status_update = 0
local last_status_val    = true

function isOnline()
    local b = getBot()
    if b == nil then return false end
    return b.status == 1
end

function getUptime()
    local e = os.time() - startTime
    return string.format("%d Days %d Hours %d Minutes %d Seconds",
        math.floor(e/86400), math.floor((e%86400)/3600),
        math.floor((e%3600)/60), e%60)
end

function checkBanned()
    while bot.status ~= BotStatus.online or bot:getPing() == 0 do
        bot.auto_reconnect = true
        sleep(5000)
        if bot.status == BotStatus.account_banned then bot:stopScript() end
    end
end

function reconnect(world, id)
    local cons = 0
    while bot:getWorld().name:upper() ~= world:upper() do
        bot:warp(world)
        sleep(5000)
        cons = cons + 1
        if cons >= 10 then
            cons = 0
            bot:disconnect()
            sleep(1000)
            checkBanned()
        end
    end
    if id ~= "" then bot:warp(world, id); sleep(3000) end
end

function extract_info_dona(str)
    str = str:gsub("%d+%[```", ""):gsub("```%d+%]", "")
    local name, quantity, item, _ = str:match("(.*) places `(.*)`` (.*)`` into the (.*)")
    return name:sub(3), quantity:sub(2), item:sub(3)
end

function extract_info_vend(str)
    str = str:gsub("%d+%[```", ""):gsub("```%d+%]", "")
    local name, item_bought, quantity, item, item_type = str:match("(.*) bought (.*) for (%d+) (.*)%.(.*)")
    if name then name = name:sub(3) end
    item = item:gsub("%.", "")
    -- Hapus 's' dari nama item (World Locks -> World Lock, dll)
    item_bought = item_bought:gsub("World Locks", "World Lock")
    item_bought = item_bought:gsub("Diamond Locks", "Diamond Lock")
    item_bought = item_bought:gsub("Blue Gem Locks", "Blue Gem Lock")
    -- Hapus 's' dari currency juga
    item = item:gsub("World Locks", "World Lock")
    item = item:gsub("Diamond Locks", "Diamond Lock")
    item = item:gsub("Blue Gem Locks", "Blue Gem Lock")
    return name, item_bought, quantity, item, item_type
end

function buildStatusJSON(is_online)
    local color, status_text
    if is_online then
        color = 65407; status_text = "Online " .. EmojiOnline
    else
        color = 16711680; status_text = "Offline " .. EmojiOffline
    end
    local world_name = bot:getWorld().name
    if world_name == "" or world_name == nil then world_name = "EXIT" end

    local desc = SEPARATOR .. "\\n"
        .. "[" .. EmojiClock .. "] **Last Update: <t:" .. os.time() .. ":R>**\\n"
        .. SEPARATOR .. "\\n"
        .. "[" .. EmojiGrowID .. "] **Name: " .. bot.name .. "**\\n"
        .. "[" .. EmojiMonitor .. "] **Status: " .. status_text .. "**\\n"
        .. SEPARATOR .. "\\n"
        .. "[" .. EmojiWorld .. "] **World: " .. world_name:upper() .. "**\\n"
        .. SEPARATOR .. "\\n"
        .. "[" .. EmojiClock .. "] **Uptime: " .. getUptime() .. "**\\n"
        .. SEPARATOR

    return '{"username":"' .. UsernameWebhook .. '","embeds":[{"title":"'
        .. EmojiCrown .. ' STATUS INFORMATION ' .. EmojiCrown
        .. '","description":"' .. desc
        .. '","color":' .. color
        .. ',"image":{"url":"' .. BannerWebhook .. '"}'
        .. ',"footer":{"text":"IF THE BOT IS OFFLINE, SEND SS TO TICKET."}'
        .. '}]}'
end

function sendStatus(is_online)
    local json = buildStatusJSON(is_online)
    if status_msg_id == nil then
        local c = HttpClient.new()
        c.url = WebhookStatus .. "?wait=true"
        c.method = Method.post
        c.headers["Content-Type"] = "application/json"
        c.content = json
        local r = c:request()
        if r.status == 200 then
            status_msg_id = r.body:match('"id":"(%d+)"')
            print("[STATUS] Pesan dibuat! ID: " .. tostring(status_msg_id))
        else
            print("[STATUS] Gagal: " .. tostring(r.status))
        end
    else
        local c = HttpClient.new()
        c.url = WebhookStatus .. "/messages/" .. status_msg_id
        c.method = Method.patch
        c.headers["Content-Type"] = "application/json"
        c.content = json
        local r = c:request()
        if r.status == 200 then
            print("[STATUS] Edit OK! " .. (is_online and "ONLINE" or "OFFLINE"))
        else
            print("[STATUS] Edit gagal " .. tostring(r.status) .. ", reset ID")
            status_msg_id = nil
        end
    end
    last_status_update = os.time()
    last_status_val    = is_online
end

-- ============================================
-- EVENT HANDLER
-- Status update dipicu oleh setiap event masuk (timer 20 detik)
-- ============================================
function OnVariantList(variant, netid)
    local now = os.time()
    local is_online = isOnline()

    -- Cek status berubah (offline/online)
    if last_status_val == true and not is_online then
        print("[OFFLINE] Bot offline!")
        sendStatus(false)
    elseif last_status_val == false and is_online then
        print("[ONLINE] Bot online!")
        sendStatus(true)
    -- Update rutin setiap 20 detik
    elseif now - last_status_update >= 20 then
        sendStatus(is_online)
    end
    if variant:get(0):getString() == "OnConsoleMessage" then
        local message = variant:get(1):getString()
        local is_dona = message:find("into the Donation Box")
        local is_vend = message:find("bought")
        local is_lock = message:find("World Lock") or message:find("Diamond Lock") or message:find("Blue Gem Lock")
        local is_cp   = message:find("CP")

        if (is_dona or is_vend) and is_lock and not is_cp then
            local webhook = Webhook.new(WebhookDonation)
            webhook.username   = UsernameWebhook
            webhook.avatar_url = AvatarWebhook
            webhook.embed1.use   = true
            webhook.embed1.color = 0xFFEEEE

            if is_dona then
                local name, quantity, item = extract_info_dona(message)

                -- Kalau donasi Blue Gem Lock, kirim pesan khusus tanpa konfirmasi
                if item:find("Blue Gem Lock") then
                    bot:say("Depo Bgl Rip")
                    webhook.embed1.title       = "<a:crown2:1269199496328384533> Donation Logs <a:crown2:1269199496328384533>"
                    webhook.embed1.description = "**[" .. EmojiGrowID .. "] GrowID: " .. name ..
                        "\n[" .. EmojiBalance .. "] Amount: " .. quantity .. " " .. item ..
                        "\n⚠️ **BGL tidak dikonfirmasi!**" .. "**"
                    webhook:send()
                    print("[BGL] " .. name .. " donasi BGL, tidak dikonfirmasi!")
                    return
                end

                bot:say("Thanks Sir")
                webhook.embed1.title       = "<a:crown2:1269199496328384533> Donation Logs <a:crown2:1269199496328384533>"
                webhook.embed1.description = "**[" .. EmojiGrowID .. "] GrowID: " .. name ..
                    "\n[" .. EmojiBalance .. "] Amount: " .. quantity .. " " .. item .. "**"
                webhook:send()
                print("[DONA] " .. name .. " | " .. quantity .. " " .. item)

            elseif is_vend then
                local name, item_bought, quantity, item, _ = extract_info_vend(message)
                bot:say("Thanks Sir")
                webhook.embed1.title       = "<a:crown2:1269199496328384533> Donation Logs <a:crown2:1269199496328384533>"
                webhook.embed1.description = "**[" .. EmojiGrowID .. "] GrowID: " .. name ..
                    "\n[" .. EmojiBalance  .. "] Amount: " .. quantity .. " " .. item ..
                    "\n[" .. EmojiProduct  .. "] Item : " .. item_bought .. "**"
                webhook:send()
                print("[VEND] " .. name .. " | " .. item_bought)
            end
        end
    end
end

-- ============================================
-- MAIN
-- ============================================
reconnect(WorldDonation, "")

-- Kirim webhook started
local c = HttpClient.new()
c.url = WebhookStarted .. "?wait=true"
c.method = Method.post
c.headers["Content-Type"] = "application/json"
c.content = buildStatusJSON(true)
c:request()

-- Kirim status awal
sendStatus(true)

-- Thread monitor offline (HTTP langsung, tidak perlu event Growtopia)
runThread(function()
    local was_online = true
    while true do
        local is_online = isOnline()

        if was_online and not is_online then
            print("[OFFLINE] Bot offline! Kirim status offline...")
            sendStatus(false)
            was_online = false
        elseif not was_online and is_online then
            print("[ONLINE] Bot online kembali!")
            sendStatus(true)
            was_online = true
        end

        sleep(3000)
    end
end)

function OnStatusChange(variant, netid)
    local is_online = isOnline()
    if last_status_val ~= is_online then
        if is_online then
            print("[ONLINE] Bot online!")
        else
            print("[OFFLINE] Bot offline!")
        end
        sendStatus(is_online)
    end
end

-- Add event dan listen selamanya
addEvent(Event.variantlist, OnVariantList)
addEvent(Event.game_message, function(msg)
    -- game_message juga trigger saat koneksi berubah
    local is_online = isOnline()
    if last_status_val ~= is_online then
        print("[STATUS CHANGE] " .. (is_online and "ONLINE" or "OFFLINE"))
        sendStatus(is_online)
    end
end)
listenEvents(99999999)
