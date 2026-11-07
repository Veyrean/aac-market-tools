-- AACMT Pack Export
-- Exports every trade pack route the game knows about (production zone -> destination),
-- with the full pack information and live demand % the game returns for each route,
-- to Documents/AAClassic/Addon/aacmt_pack_export/export.txt
--
-- Uses only the official ArcheAge Classic Addon API (read-only):
--   Store:GetProductionZoneGroups, Store:GetSellableZoneGroups,
--   Store:GetSpecialtyRatioBetween (answered by the SPECIALTY_RATIO_BETWEEN_INFO event),
--   Item:GetItemInfoByType, File:Write.
-- It makes no network requests and stores no character or account information.
--
-- Usage in game:  /packexport        (start)
--                 /packexport stop   (cancel)

local api = require("api")

local addon = {
    name = "AACMT Pack Export",
    author = "aac-market-tools",
    version = "0.1.0",
    desc = "Exports trade pack routes, pack info and demand % to a file. Type /packexport",
}

local OUT_PATH = "aacmt_pack_export/export.txt"
local TIMEOUT_MS = 6000   -- give up on a route the game does not answer
local GAP_MS = 1200       -- pause between requests, to stay gentle with the server

local frame = nil
local queue = {}
local pending = nil
local pendingSince = 0
local waitUntil = 0
local running = false
local result = nil

-- Copy only plain data (text, numbers, booleans, nested tables) so the file can be written.
local function copy(value, depth)
    local t = type(value)
    if t == "string" or t == "number" or t == "boolean" then
        return value
    end
    if t ~= "table" or depth > 4 then
        return nil
    end
    local out = {}
    for k, v in pairs(value) do
        if type(k) == "string" or type(k) == "number" then
            local c = copy(v, depth + 1)
            if c ~= nil then
                out[k] = c
            end
        end
    end
    return out
end

local function now()
    return api.Time:GetUiMsec()
end

local function finish()
    running = false
    pending = nil
    -- Also store the generic item info of one pack, to compare with the route data.
    for _, route in ipairs(result.routes) do
        local first = route.packs[1]
        if first and first.itemInfo and first.itemInfo.itemType then
            result.sampleItemInfoByType = copy(api.Item:GetItemInfoByType(first.itemInfo.itemType), 0)
            break
        end
    end
    result.finishedAtMs = now()
    api.File:Write(OUT_PATH, result)
    api.Log:Info("[PackExport] Done: " .. result.routeCount .. " routes (" .. result.timeouts ..
        " without answer) written to Documents/AAClassic/Addon/" .. OUT_PATH)
end

local function nextRoute()
    local route = table.remove(queue, 1)
    if not route then
        finish()
        return
    end
    pending = route
    pendingSince = now()
    api.Store:GetSpecialtyRatioBetween(route.from.id, route.to.id)
end

local function onRatioData(data)
    if not running or not pending then
        return
    end
    local route = pending
    pending = nil
    local packs = {}
    if type(data) == "table" then
        for _, value in pairs(data) do
            if type(value) == "table" then
                table.insert(packs, copy(value, 0))
            end
        end
    end
    table.insert(result.routes, { from = route.from, to = route.to, packs = packs })
    result.routeCount = result.routeCount + 1
    if result.routeCount % 10 == 0 then
        api.Log:Info("[PackExport] " .. result.routeCount .. " routes done, " .. #queue .. " to go...")
    end
    waitUntil = now() + GAP_MS
end

local function start()
    if running then
        api.Log:Info("[PackExport] Already running. Type /packexport stop to cancel.")
        return
    end
    local prod = api.Store:GetProductionZoneGroups()
    if type(prod) ~= "table" then
        api.Log:Err("[PackExport] The game returned no production zones.")
        return
    end
    result = {
        format = "aacmt-pack-export",
        version = 1,
        routes = {},
        routeCount = 0,
        timeouts = 0,
        startedAtMs = now(),
        sellerShareRatio = copy(api.Store:GetSellerShareRatio(), 0),
        specialtyRatio = copy(api.Store:GetSpecialtyRatio(), 0),
        productionZones = copy(prod, 0),
    }
    queue = {}
    for _, zone in pairs(prod) do
        if type(zone) == "table" and zone.id then
            local dests = api.Store:GetSellableZoneGroups(zone.id)
            if type(dests) == "table" then
                for _, dest in pairs(dests) do
                    if type(dest) == "table" and dest.id then
                        table.insert(queue, {
                            from = { id = zone.id, name = zone.name },
                            to = { id = dest.id, name = dest.name },
                        })
                    end
                end
            end
        end
    end
    if #queue == 0 then
        api.Log:Err("[PackExport] No routes found.")
        return
    end
    running = true
    waitUntil = 0
    api.Log:Info("[PackExport] Exporting " .. #queue .. " routes. This takes about " ..
        math.ceil(#queue * (GAP_MS + 300) / 60000) .. " minute(s); you can keep playing.")
end

local function stop()
    if running then
        running = false
        pending = nil
        queue = {}
        api.Log:Info("[PackExport] Cancelled. Nothing was written.")
    end
end

local function onUpdate()
    if not running then
        return
    end
    local t = now()
    if pending then
        if t - pendingSince > TIMEOUT_MS then
            table.insert(result.routes, { from = pending.from, to = pending.to, packs = {}, timedOut = true })
            result.routeCount = result.routeCount + 1
            result.timeouts = result.timeouts + 1
            pending = nil
            waitUntil = t + GAP_MS
        end
    elseif t >= waitUntil then
        nextRoute()
    end
end

local function Load()
    frame = api.Interface:CreateEmptyWindow("aacmt_pack_export_frame")
    frame:Show(true)

    function frame:OnEvent(event, ...)
        if event == "SPECIALTY_RATIO_BETWEEN_INFO" then
            onRatioData(unpack(arg))
        end
    end
    frame:SetHandler("OnEvent", frame.OnEvent)
    frame:RegisterEvent("SPECIALTY_RATIO_BETWEEN_INFO")

    function frame:OnUpdate()
        onUpdate()
    end
    frame:SetHandler("OnUpdate", frame.OnUpdate)

    api.On("SLASH_COMMAND", function(command, args)
        if command == "packexport" then
            if args == "stop" then
                stop()
            else
                start()
            end
        end
    end)

    api.Log:Info("[PackExport] Loaded. Type /packexport to export trade pack data.")
end

local function Unload()
    running = false
    if frame then
        frame:ReleaseHandler("OnEvent")
        frame:ReleaseHandler("OnUpdate")
        frame:Show(false)
        frame = nil
    end
end

addon.OnLoad = Load
addon.OnUnload = Unload

return addon
