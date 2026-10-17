"""Pull real Tibia game data from the Canary server project (github.com/opentibiabr/canary)
and write src/tibia/data.json: monsters, spells, runes, spell areas, items, vocations, potions.

Usage: python tools/fetch_tibia_data.py        (downloads are cached in tools/.cache)
"""
import json
import os
import re
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, "tools", ".cache")
OUT = os.path.join(ROOT, "src", "tibia", "data.json")
BASE = "https://raw.githubusercontent.com/opentibiabr/canary/main/"

MONSTERS = [
    "rat", "bat", "snake", "spider", "bug", "wolf", "cave rat", "troll", "orc", "rotworm", "poison spider",
    "orc spearman", "orc shaman", "orc warrior", "skeleton", "ghoul", "minotaur", "slime", "scorpion", "dwarf soldier",
    "hunter", "amazon", "valkyrie", "orc berserker", "cyclops", "mummy", "ghost", "demon skeleton", "giant spider",
    "vampire", "necromancer", "bonelord", "dragon", "banshee", "hero", "lich", "behemoth", "hydra", "dragon lord",
    "demon", "juggernaut", "demodras", "orshabaal", "ferumbras",
    # bosses
    "munster", "teleskor", "apprentice sheng", "rotworm queen", "the horned fox", "warlord ruzad", "the evil eye",
    "general murius", "necropharus", "dharalion", "the frog prince", "zevelon duskbringer", "the old widow",
    "the snapper", "the many", "the plasmother", "dracola", "ghazbaran", "morgaroth", "gaz'haragoth",
]

SPELL_FILES = {
    "attack": [
        "annihilation", "berserk", "brutal_strike", "death_strike", "divine_caldera", "divine_missile", "energy_beam",
        "energy_strike", "energy_wave", "eternal_winter", "ethereal_spear", "fierce_berserk", "fire_wave", "flame_strike",
        "front_sweep", "great_energy_beam", "groundshaker", "hells_core", "ice_strike", "ice_wave", "rage_of_the_skies",
        "strong_energy_strike", "strong_ethereal_spear", "strong_flame_strike", "strong_ice_strike", "strong_ice_wave",
        "strong_terra_strike", "terra_strike", "terra_wave", "ultimate_energy_strike", "ultimate_flame_strike",
        "ultimate_ice_strike", "ultimate_terra_strike", "whirlwind_throw", "wrath_of_nature", "great_death_beam",
    ],
    "healing": [
        "light_healing", "intense_healing", "ultimate_healing", "wound_cleansing", "intense_wound_cleansing",
        "fair_wound_cleansing", "divine_healing", "mass_healing", "salvation",
    ],
    "support": ["magic_shield"],
}
RUNE_FILES = [
    "avalanche", "great_fireball", "sudden_death", "thunderstorm", "stone_shower", "explosion", "fireball",
    "heavy_magic_missile", "holy_missile", "icicle", "stalagmite", "light_magic_missile", "intense_healing_rune",
    "ultimate_healing_rune",
]
# Which vocations conjure each rune (from data/scripts/spells/conjuring); "classes only use their own runes".
CONJURE_FILES = {
    "avalanche": "avalanche_rune", "great_fireball": "great_fireball_rune", "sudden_death": "sudden_death_rune",
    "thunderstorm": "thunderstorm_rune", "stone_shower": "stone_shower_rune", "explosion": "explosion_rune",
    "fireball": "fireball_rune", "heavy_magic_missile": "heavy_magic_missile_rune", "holy_missile": "holy_missile_rune",
    "icicle": "icicle_rune", "stalagmite": "stalagmite_rune", "light_magic_missile": "light_magic_missile_rune",
    "intense_healing_rune": "intense_healing_rune", "ultimate_healing_rune": "ultimate_healing_rune",
}

STARTER_ITEMS = [
    # knight
    "sword", "spike sword", "steel shield", "chain armor", "brass helmet", "brass legs", "leather boots",
    # paladin
    "bow", "arrow", "spear", "leather armor", "leather helmet", "leather legs",
    # mages
    "wand of vortex", "snakebite rod", "blue robe", "magician hat",
    "health potion", "mana potion", "strong health potion", "strong mana potion", "great health potion",
    "great mana potion", "great spirit potion", "ultimate health potion", "treasure chest", "club", "wooden shield", "coat", "gold coin", "platinum coin", "crystal coin",
    # runes (sold in the shop)
    "great fireball rune", "sudden death rune", "thunderstorm rune", "avalanche rune", "stone shower rune",
    "icicle rune", "fireball rune", "holy missile rune", "explosion rune", "heavy magic missile rune",
    "stalagmite rune", "light magic missile rune", "intense healing rune", "ultimate healing rune",
]


def fetch(path):
    os.makedirs(CACHE, exist_ok=True)
    local = os.path.join(CACHE, path.replace("/", "__"))
    if not os.path.exists(local):
        with urllib.request.urlopen(BASE + path) as r:
            data = r.read()
        with open(local, "wb") as fh:
            fh.write(data)
    with open(local, encoding="utf-8", errors="replace") as fh:
        return fh.read()


def tree():
    local = os.path.join(CACHE, "tree.json")
    if not os.path.exists(local):
        os.makedirs(CACHE, exist_ok=True)
        req = urllib.request.Request("https://api.github.com/repos/opentibiabr/canary/git/trees/main?recursive=1",
                                     headers={"User-Agent": "tibia-survivors"})
        with urllib.request.urlopen(req) as r, open(local, "wb") as fh:
            fh.write(r.read())
    return [t["path"] for t in json.load(open(local))["tree"]]


# ---------- enums ----------

def enums():
    src = fetch("src/utils/utils_definitions.hpp")
    out = {}
    for block in ("MagicEffectClasses", "ShootType_t"):
        body = re.search(r"enum %s[^{]*\{(.*?)\};" % block, src, re.S).group(1)
        val = -1
        for line in body.splitlines():
            m = re.match(r"\s*(CONST_\w+)\s*(?:=\s*(\w+))?\s*,", line)
            if not m:
                continue
            val = int(m.group(2), 0) if m.group(2) and m.group(2)[0].isdigit() else (out.get(m.group(2), val) if m.group(2) else val + 1)
            out[m.group(1)] = val
    return out


ELEMENT = {
    "COMBAT_PHYSICALDAMAGE": "physical", "COMBAT_ENERGYDAMAGE": "energy", "COMBAT_EARTHDAMAGE": "earth",
    "COMBAT_FIREDAMAGE": "fire", "COMBAT_LIFEDRAIN": "lifedrain", "COMBAT_MANADRAIN": "manadrain",
    "COMBAT_DROWNDAMAGE": "drown", "COMBAT_ICEDAMAGE": "ice", "COMBAT_HOLYDAMAGE": "holy",
    "COMBAT_DEATHDAMAGE": "death", "COMBAT_HEALING": "healing", "COMBAT_UNDEFINEDDAMAGE": "physical",
}


# ---------- lua helpers ----------

def lua_value(v):
    v = v.strip()
    if re.fullmatch(r"-?\d+(\.\d+)?", v):
        return float(v) if "." in v else int(v)
    if v in ("true", "false"):
        return v == "true"
    if v.startswith('"'):
        return v.strip('"')
    return v  # identifier (CONST_*, COMBAT_*)


def lua_fields(entry):
    return {k: lua_value(v) for k, v in re.findall(r"(\w+)\s*=\s*(\"[^\"]*\"|[^,}]+)", entry)}


def lua_block(src, start_pat):
    """Return the text inside the braces that follow start_pat (balanced)."""
    m = re.search(start_pat, src)
    if not m:
        return ""
    i = src.index("{", m.end() - 1)
    depth = 0
    for j in range(i, len(src)):
        if src[j] == "{":
            depth += 1
        elif src[j] == "}":
            depth -= 1
            if depth == 0:
                return src[i + 1:j]
    return ""


def entries(block):
    """Top-level {...} entries of a lua table body."""
    out, depth, start = [], 0, None
    for i, c in enumerate(block):
        if c == "{":
            if depth == 0:
                start = i
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0 and start is not None:
                out.append(block[start + 1:i])
    return out


# ---------- monsters ----------

def parse_monster(src, en):
    num = lambda pat, d=0: int(re.search(pat, src).group(1)) if re.search(pat, src) else d
    m = {
        "name": re.search(r'Game\.createMonsterType\("([^"]+)"\)', src).group(1),
        "health": num(r"monster\.health\s*=\s*(\d+)"),
        "experience": num(r"monster\.experience\s*=\s*(\d+)"),
        "speed": num(r"monster\.speed\s*=\s*(\d+)"),
        "lookType": num(r"lookType\s*=\s*(\d+)"),
        "corpse": num(r"monster\.corpse\s*=\s*(\d+)"),
    }
    flags = lua_fields(lua_block(src, r"monster\.flags\s*=\s*\{"))
    m["targetDistance"] = int(flags.get("targetDistance", 1) or 1)
    m["runHealth"] = int(flags.get("runHealth", 0) or 0)
    attacks = []
    for e in entries(lua_block(src, r"monster\.attacks\s*=\s*\{")):
        f = lua_fields(e)
        a = {"name": f.get("name"), "interval": f.get("interval", 2000), "chance": f.get("chance", 100),
             "min": abs(f.get("minDamage", 0) or 0), "max": abs(f.get("maxDamage", 0) or 0)}
        if a["name"] != "melee":
            a["element"] = ELEMENT.get(f.get("type"), None)
            for k in ("range", "radius", "length", "spread"):
                if isinstance(f.get(k), int):
                    a[k] = f[k]
            a["target"] = bool(f.get("target", False))
            a["shoot"] = en.get(f.get("shootEffect"), 0)
            a["effect"] = en.get(f.get("effect"), 0)
            if not a["element"] or a["max"] == 0:
                continue  # skip non-damage spells (speed, outfit, fields, summons)
        attacks.append(a)
    m["attacks"] = attacks
    defs = lua_block(src, r"monster\.defenses\s*=\s*\{")
    df = lua_fields(re.sub(r"\{[^{}]*\}", "", defs))
    m["defense"] = int(df.get("defense", 0) or 0)
    m["armor"] = int(df.get("armor", 0) or 0)
    heals = []
    for e in entries(defs):
        f = lua_fields(e)
        if f.get("type") == "COMBAT_HEALING":
            heals.append({"interval": f.get("interval", 2000), "chance": f.get("chance", 0),
                          "min": abs(f.get("minDamage", 0)), "max": abs(f.get("maxDamage", 0))})
    m["heals"] = heals
    el = {}
    for e in entries(lua_block(src, r"monster\.elements\s*=\s*\{")):
        f = lua_fields(e)
        if f.get("type") in ELEMENT and f.get("percent"):
            el[ELEMENT[f["type"]]] = f["percent"]
    for e in entries(lua_block(src, r"monster\.immunities\s*=\s*\{")):
        f = lua_fields(e)
        if f.get("combat") is True and isinstance(f.get("type"), str):
            el[{"earth": "earth", "fire": "fire", "energy": "energy", "ice": "ice", "holy": "holy", "death": "death",
                "physical": "physical", "lifedrain": "lifedrain", "manadrain": "manadrain", "drown": "drown"}.get(f["type"], f["type"])] = 100
    m["elements"] = el
    loot = []
    for e in entries(lua_block(src, r"monster\.loot\s*=\s*\{")):
        f = lua_fields(e)
        if isinstance(f.get("id"), int):
            loot.append({"id": f["id"], "chance": f.get("chance", 0), "max": f.get("maxCount", 1)})
        elif isinstance(f.get("name"), str):
            loot.append({"name": f["name"], "chance": f.get("chance", 0), "max": f.get("maxCount", 1)})
    m["loot"] = loot
    return m


# ---------- spells ----------

AREAS = {}


def parse_areas():
    src = fetch("data/scripts/lib/register_spells.lua")
    for name, body in re.findall(r"(AREA_\w+)\s*=\s*\{(.*?)\n\}", src, re.S):
        rows = [[int(x) for x in re.findall(r"-?\d+", r)] for r in re.findall(r"\{([^{}]*)\}", body)]
        if rows:
            AREAS[name] = rows


def lua_to_js(body):
    body = re.sub(r"--[^\n]*", "", body)
    body = body.replace("player:getLevel()", "level").replace("player:getMagicLevel()", "maglevel")
    body = re.sub(r"\blocal\s+", "let ", body)
    body = body.replace("math.floor", "Math.floor").replace("math.max", "Math.max").replace("math.min", "Math.min")
    body = body.replace("math.ceil", "Math.ceil").replace("math.random", "rand").replace("~=", "!==")
    body = re.sub(r"\bif\s+(.*?)\s+then\b", r"if (\1) {", body)
    body = re.sub(r"\belseif\s+(.*?)\s+then\b", r"} else if (\1) {", body)
    body = re.sub(r"\belse\b", "} else {", body)
    body = re.sub(r"\bend\b", "}", body)
    body = re.sub(r"\band\b", "&&", body)
    body = re.sub(r"\bor\b", "||", body)
    body = re.sub(r"return\s+(.+?),\s*(.+?)\s*$", r"return [\1, \2];", body, flags=re.M)
    return "\n".join(l.rstrip() for l in body.strip().splitlines())


def parse_spell(src, en):
    s = {}
    get = lambda pat: re.search(pat, src).group(1) if re.search(pat, src) else None
    s["name"] = get(r':name\("([^"]+)"\)')
    s["words"] = get(r':words\("([^"]+)"\)')
    s["group"] = get(r':group\("([^"]+)"\)')
    for k in ("level", "mana", "range", "magicLevel", "runeId"):
        v = get(r":%s\((\d+)\)" % k)
        if v:
            s[k] = int(v)
    for k in ("cooldown", "groupCooldown"):
        v = get(r":%s\(([^)]+)\)" % k)
        if v:
            expr = v.split(",")[0].replace(" ", "")
            if re.fullmatch(r"[\d*+]+", expr):
                total = 0
                for term in expr.split("+"):
                    prod = 1
                    for f in term.split("*"):
                        prod *= int(f)
                    total += prod
                s[k] = total
    s["needDirection"] = bool(re.search(r":needDirection\(true\)", src))
    s["needTarget"] = bool(re.search(r":needTarget\(true\)|needCasterTargetOrDirection\(true\)", src))
    s["selfTarget"] = bool(re.search(r":isSelfTarget\(true\)", src))
    voc = get(r':vocation\(([^)]*)\)')
    s["vocations"] = sorted({v.split(";")[0].strip().strip('"').lower() for v in voc.split(",")}) if voc else []
    s["element"] = ELEMENT.get(get(r"COMBAT_PARAM_TYPE,\s*(\w+)"), "physical")
    s["effect"] = en.get(get(r"COMBAT_PARAM_EFFECT,\s*(\w+)"), 0)
    s["shoot"] = en.get(get(r"COMBAT_PARAM_DISTANCEEFFECT,\s*(\w+)"), 0)
    s["blockArmor"] = bool(re.search(r"COMBAT_PARAM_BLOCKARMOR,\s*(1|true)", src))
    area = get(r"createCombatArea\((AREA_\w+)")
    if area:
        s["area"] = area
    elif re.search(r"createCombatArea\(\s*(\w+)", src):
        var = get(r"createCombatArea\(\s*(\w+)")
        body = lua_block(src, r"local\s+%s\s*=\s*\{" % re.escape(var)) if var else ""
        rows = [[int(x) for x in re.findall(r"-?\d+", r)] for r in re.findall(r"\{([^{}]*)\}", body)]
        if rows:
            s["areaRows"] = rows
    if "area" not in s and "areaRows" not in s:
        m = re.search(r"\b(AREA_\w+)", src)
        if m:
            s["area"] = m.group(1)
    # The damage formula: the onGetFormulaValues callback (or the helper it calls). Keep only
    # `local x = <arithmetic>` lines and the return; the game checks them against a token whitelist.
    for params, body in re.findall(r"function\s+[\w.]*\(([^)]*)\)(.*?)\n\s*end\b", src, re.S):
        if "return" not in body or not re.search(r"\b(min|skillTotal|levelTotal)\b|return -?\(", body):
            continue
        lines = []
        for raw in body.split("\n"):
            line = re.sub(r"--.*", "", raw).strip()
            line = line.replace("player:getLevel()", "level").replace("player:getMagicLevel()", "maglevel")
            m = re.fullmatch(r"local (\w+) = ([\w\s.+\-*/()]+)", line)
            if m and m.group(1) not in ("level", "player"):
                lines.append(f"const {m.group(1)} = {m.group(2)};")
            elif line.startswith("return"):
                parts = line[len("return"):].strip()
                depth, cut = 0, None
                for i, c in enumerate(parts):
                    depth += c == "("
                    depth -= c == ")"
                    if c == "," and depth == 0:
                        cut = i
                        break
                if cut is None:
                    # e.g. mass healing computes min/max and applies them itself
                    if any(l.startswith("const min") for l in lines) and any(l.startswith("const max") for l in lines):
                        lines.append("return [min, max];")
                    break
                lines.append(f"return [{parts[:cut].strip()}, {parts[cut + 1:].strip()}];")
                break
        if lines and lines[-1].startswith("return"):
            s["formulaKind"] = "skill" if "skill" in params else "magic"
            s["formula"] = "\n".join(lines)
            break
    if s.get("group") == "healing":
        s["element"] = "healing"
    return s


# ---------- items ----------

def parse_items(ids, names):
    src = fetch("data/items/items.xml")
    by_name, out = {}, {}
    for m in re.finditer(r'<item (?:id|fromid)="(\d+)"[^>]*?name="([^"]*)"', src):
        by_name.setdefault(m.group(2).lower(), int(m.group(1)))
    ids = set(ids) | {by_name[n] for n in names if n in by_name}
    for m in re.finditer(r'<item id="(\d+)"([^>]*?)(/>|>(.*?)</item>)', src, re.S):
        iid = int(m.group(1))
        if iid not in ids:
            continue
        name = re.search(r'name="([^"]*)"', m.group(2))
        it = {"id": iid, "name": name.group(1) if name else ""}
        body = m.group(4) or ""
        for k, v in re.findall(r'<attribute key="([^"]+)" value="([^"]*)"', body):
            if " " in k:
                continue  # imbuement slot details, not item stats
            k = k.lower()
            if k in ("description", "weight", "imbuementslot", "script", "primarytype", "decayto", "duration",
                     "showduration", "showattributes", "showcharges", "stopduration", "transformdeequipto"):
                continue
            if k in it and k != "weapontype":
                continue
            it[k] = int(v) if re.fullmatch(r"-?\d+", v) else v
        out[iid] = it
    return out, by_name


def main():
    paths = tree()
    en = enums()
    parse_areas()

    monsters = {}
    for name in MONSTERS:
        fn = name.replace(" ", "_") + ".lua"
        cands = [p for p in paths if p.endswith("/" + fn) and "/monster/" in p and p.startswith("data-otservbr-global")]
        if not cands:
            print("missing monster", name, file=sys.stderr)
            continue
        monsters[name] = parse_monster(fetch(cands[0]), en)

    spells = []
    for group, files in SPELL_FILES.items():
        for f in files:
            s = parse_spell(fetch(f"data/scripts/spells/{group}/{f}.lua"), en)
            s["file"] = f
            s["kind"] = "instant"
            spells.append(s)
    for f in RUNE_FILES:
        s = parse_spell(fetch(f"data/scripts/runes/{f}.lua"), en)
        s["file"] = f
        s["kind"] = "rune"
        conj = parse_spell(fetch(f"data/scripts/spells/conjuring/{CONJURE_FILES[f]}.lua"), en)
        s["vocations"] = conj["vocations"]
        s["conjureLevel"] = conj.get("level", 0)
        spells.append(s)

    # NPC shops: the cheapest price an NPC sells an item for, and the best price one pays for it.
    from concurrent.futures import ThreadPoolExecutor
    npc_files = [p for p in paths if p.startswith("data-otservbr-global/npc/") and p.endswith(".lua")]
    with ThreadPoolExecutor(16) as ex:
        npc_srcs = list(ex.map(fetch, npc_files))
    prices = {}
    for src in npc_srcs:
        for e in re.findall(r"\{[^{}]*clientId\s*=\s*\d+[^{}]*\}", src):
            f = lua_fields(e)
            iid = f.get("clientId")
            if not isinstance(iid, int):
                continue
            pr = prices.setdefault(iid, {})
            if isinstance(f.get("buy"), int) and f["buy"] > 0:
                pr["buy"] = min(pr.get("buy", 1 << 30), f["buy"])
            if isinstance(f.get("sell"), int) and f["sell"] > 0:
                pr["sell"] = max(pr.get("sell", 0), f["sell"])

    loot_ids = {l["id"] for m in monsters.values() for l in m["loot"] if "id" in l}
    loot_ids |= {m["corpse"] for m in monsters.values() if m["corpse"]}
    real_loot = set(loot_ids)
    loot_ids |= {i for i, p in prices.items() if "buy" in p}  # anything an NPC sells could be bought
    loot_names = {l["name"].lower() for m in monsters.values() for l in m["loot"] if "name" in l}
    items, by_name = parse_items(loot_ids, set(STARTER_ITEMS) | loot_names)
    # Rings and the like turn into another item when equipped; that one carries the stats.
    equipped = {it["transformequipto"] for it in items.values() if isinstance(it.get("transformequipto"), int)}
    if equipped - set(items):
        items, by_name = parse_items(loot_ids | equipped, set(STARTER_ITEMS) | loot_names)
    for m in monsters.values():
        for l in m["loot"]:
            if "name" in l and l["name"].lower() in by_name:
                l["id"] = by_name[l["name"].lower()]
        m["loot"] = [l for l in m["loot"] if "id" in l and l["id"] in items]
        real_loot |= {l["id"] for l in m["loot"]}
    # Keep shop items only if they are equipment (weapons, armor, rings...); drop food, tools and so on.
    keep = real_loot | set(by_name[n] for n in STARTER_ITEMS if n in by_name) | equipped
    items = {i: it for i, it in items.items() if i in keep or it.get("slot") or it.get("weapontype") or it.get("transformequipto")}
    starter = {n: by_name[n] for n in STARTER_ITEMS if n in by_name}

    voc_src = fetch("data/XML/vocations.xml")
    vocations = {}
    for v in re.findall(r"<vocation [^>]*>.*?</vocation>", voc_src, re.S):
        a = dict(re.findall(r'(\w+)="([^"]*)"', v.split(">")[0]))
        name = a["name"].lower()
        if name not in ("none", "knight", "paladin", "sorcerer", "druid"):
            continue
        f = dict(re.findall(r'(\w+)="([^"]*)"', re.search(r"<formula[^>]*>", v).group(0)))
        mit = dict(re.findall(r'(\w+)="([^"]*)"', re.search(r"<mitigation[^>]*>", v).group(0)))
        vocations[name] = {
            "gainHp": int(a["gainhp"]), "gainMana": int(a["gainmana"]),
            "gainHpTicks": int(a["gainhpticks"]), "gainHpAmount": int(a["gainhpamount"]),
            "gainManaTicks": int(a["gainmanaticks"]), "gainManaAmount": int(a["gainmanaamount"]),
            "manaMultiplier": float(a["manamultiplier"]), "baseSpeed": int(a["basespeed"]),
            "attackSpeed": int(a["attackspeed"]),
            "meleeDamage": float(f["meleeDamage"]), "distDamage": float(f["distDamage"]),
            "defense": float(f["defense"]), "armor": float(f["armor"]),
            "mitigation": float(mit["multiplier"]), "primaryShield": float(mit["primaryShield"]),
            "secondaryShield": float(mit["secondaryShield"]),
            "skillMultipliers": [float(x) for _, x in re.findall(r'<skill id="(\d+)" multiplier="([\d.]+)"', v)],
        }

    potions = {
        266: {"health": [125, 175]}, 236: {"health": [250, 350], "level": 50, "voc": ["paladin", "knight"]},
        239: {"health": [425, 575], "level": 80, "voc": ["knight"]},
        268: {"mana": [75, 125]}, 237: {"mana": [115, 185], "level": 50},
        238: {"mana": [150, 250], "level": 80, "voc": ["sorcerer", "druid", "paladin"]},
        7642: {"health": [250, 350], "mana": [100, 200], "level": 80, "voc": ["paladin"]},
        7643: {"health": [650, 850], "level": 130, "voc": ["knight"]},
    }  # data/scripts/actions/items/potions.lua

    used_areas = {s["area"] for s in spells if "area" in s}
    data = {
        "source": "opentibiabr/canary (main)",
        "monsters": monsters, "spells": spells, "areas": {k: AREAS[k] for k in used_areas if k in AREAS},
        "items": items, "starter": starter, "vocations": vocations, "potions": potions,
        "prices": {i: p for i, p in prices.items() if i in items},
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=1)
    print(f"{len(monsters)} monsters, {len(spells)} spells/runes, {len(items)} items -> {OUT}")


if __name__ == "__main__":
    main()
