#!/usr/bin/env python3
"""Genererar apps/web/src/lib/emoji/data.ts — den kurerade emoji-katalogen för
anslagstavlans emoji-väljare (CLAUDE.md § 37.6).

Ingen extern datakälla (ingen CDN, ingen nätverkshämtning — § 1 "inga externa
CDN-anrop"): listan är handkurerad här och namnen slås upp lokalt via Pythons
unicodedata. Kör om vid ändring:

    python3 apps/web/scripts/generate-emoji-data.py
"""
import json
import unicodedata
from pathlib import Path

# Kodpunkter i SMP som är text-presentation per default och därför behöver
# VS16 (U+FE0F) för att renderas som emoji. BMP-emoji får alltid VS16.
TEXT_DEFAULT_SMP = set(
    [0x1F321, 0x1F336, 0x1F37D, 0x1F396, 0x1F397, 0x1F39E, 0x1F39F, 0x1F3F3, 0x1F3F5,
     0x1F3F7, 0x1F43F, 0x1F441, 0x1F4FD, 0x1F549, 0x1F54A, 0x1F56F, 0x1F570, 0x1F587,
     0x1F590, 0x1F5A5, 0x1F5A8, 0x1F5B1, 0x1F5B2, 0x1F5BC, 0x1F5E1, 0x1F5E3, 0x1F5E8,
     0x1F5EF, 0x1F5F3, 0x1F5FA, 0x1F6CB, 0x1F6E9, 0x1F6F0, 0x1F6F3]
    + list(range(0x1F324, 0x1F32D)) + list(range(0x1F399, 0x1F39C))
    + list(range(0x1F3CB, 0x1F3CF)) + list(range(0x1F3D4, 0x1F3E0))
    + list(range(0x1F573, 0x1F57A)) + list(range(0x1F58A, 0x1F58E))
    + list(range(0x1F5C2, 0x1F5C5)) + list(range(0x1F5D1, 0x1F5D4))
    + list(range(0x1F5DC, 0x1F5DF)) + list(range(0x1F6CD, 0x1F6D0))
    + list(range(0x1F6E0, 0x1F6E6))
)

GROUPS = [
    ("smileys", "Smileys & känslor", """
😀 😃 😄 😁 😆 😅 🤣 😂 🙂 🙃 🫠 😉 😊 😇 🥰 😍 🤩 😘 😗 ☺ 😚 😙 🥲 😋 😛 😜 🤪 😝 🤑
🤗 🤭 🫢 🫣 🤫 🤔 🫡 🤐 🤨 😐 😑 😶 🫥 😏 😒 🙄 😬 🤥 😌 😔 😪 🤤 😴 😷 🤒 🤕 🤢 🤮
🤧 🥵 🥶 🥴 😵 🤯 🤠 🥳 🥸 😎 🤓 🧐 😕 🫤 😟 🙁 ☹ 😮 😯 😲 😳 🥺 🥹 😦 😧 😨 😰 😥 😢
😭 😱 😖 😣 😞 😓 😩 😫 🥱 😤 😡 😠 🤬 😈 👿 💀 ☠ 💩 🤡 👹 👺 👻 👽 👾 🤖
😺 😸 😹 😻 😼 😽 🙀 😿 😾 🙈 🙉 🙊
💋 💌 💘 💝 💖 💗 💓 💞 💕 💟 ❣ 💔 ❤ 🩷 🧡 💛 💚 💙 🩵 💜 🤎 🖤 🩶 🤍
💯 💢 💥 💫 💦 💨 🕳 💣 💬 👁‍🗨 🗨 🗯 💭 💤
"""),
    ("people", "Människor & gester", """
👋 🤚 🖐 ✋ 🖖 🫱 🫲 🫳 🫴 🫷 🫸 👌 🤌 🤏 ✌ 🤞 🫰 🤟 🤘 🤙 👈 👉 👆 🖕 👇 ☝ 🫵 👍 👎 ✊
👊 🤛 🤜 👏 🙌 🫶 👐 🤲 🤝 🙏 ✍ 💅 🤳 💪 🦾 🦿 🦵 🦶 👂 🦻 👃 🧠 🫀 🫁 🦷 🦴 👀 👁 👅 👄 🫦
👶 🧒 👦 👧 🧑 👱 👨 🧔 👩 🧓 👴 👵 🙍 🙎 🙅 🙆 💁 🙋 🧏 🙇 🤦 🤷
👮 🕵 💂 🥷 👷 🫅 🤴 👸 👳 👲 🧕 🤵 👰 🤰 🫃 🫄 🤱 👼 🎅 🤶 🦸 🦹 🧙 🧚 🧛 🧜 🧝 🧞 🧟 🧌
💆 💇 🚶 🧍 🧎 🏃 💃 🕺 🕴 👯 🧖 🧗 🤺 🏇 ⛷ 🏂 🏌 🏄 🚣 🏊 ⛹ 🏋 🚴 🚵 🤸 🤼 🤽 🤾 🤹 🧘 🛀 🛌
👭 👫 👬 💏 💑 👪 🗣 👤 👥 🫂 👣
"""),
    ("animals", "Djur & natur", """
🐵 🐒 🦍 🦧 🐶 🐕 🦮 🐕‍🦺 🐩 🐺 🦊 🦝 🐱 🐈 🐈‍⬛ 🦁 🐯 🐅 🐆 🐴 🫎 🫏 🐎 🦄 🦓 🦌 🦬 🐮 🐂 🐃 🐄
🐷 🐖 🐗 🐽 🐏 🐑 🐐 🐪 🐫 🦙 🦒 🐘 🦣 🦏 🦛 🐭 🐁 🐀 🐹 🐰 🐇 🐿 🦫 🦔 🦇 🐻 🐻‍❄️ 🐨 🐼 🦥 🦦
🦨 🦘 🦡 🐾 🦃 🐔 🐓 🐣 🐤 🐥 🐦 🐧 🕊 🦅 🦆 🦢 🦉 🦤 🪶 🦩 🦚 🦜 🪽 🐦‍⬛ 🪿 🐸 🐊 🐢 🦎 🐍 🐲 🐉
🦕 🦖 🐳 🐋 🐬 🦭 🐟 🐠 🐡 🦈 🐙 🐚 🪸 🪼 🐌 🦋 🐛 🐜 🐝 🪲 🐞 🦗 🪳 🕷 🕸 🦂 🦟 🪰 🪱 🦠
💐 🌸 💮 🪷 🏵 🌹 🥀 🌺 🌻 🌼 🌷 🪻 🌱 🪴 🌲 🌳 🌴 🌵 🌾 🌿 ☘ 🍀 🍁 🍂 🍃 🪹 🪺 🍄
🌍 🌎 🌏 🌐 🌑 🌒 🌓 🌔 🌕 🌖 🌗 🌘 🌙 🌚 🌛 🌜 ☀ 🌝 🌞 🪐 ⭐ 🌟 🌠 🌌 ☁ ⛅ ⛈ 🌤 🌥 🌦 🌧 🌨
🌩 🌪 🌫 🌬 🌀 🌈 🌂 ☂ ☔ ⛱ ⚡ ❄ ☃ ⛄ ☄ 🔥 💧 🌊
"""),
    ("food", "Mat & dryck", """
🍇 🍈 🍉 🍊 🍋 🍌 🍍 🥭 🍎 🍏 🍐 🍑 🍒 🍓 🫐 🥝 🍅 🫒 🥥 🥑 🍆 🥔 🥕 🌽 🌶 🫑 🥒 🥬 🥦 🧄 🧅
🥜 🫘 🌰 🫚 🫛 🍞 🥐 🥖 🫓 🥨 🥯 🥞 🧇 🧀 🍖 🍗 🥩 🥓 🍔 🍟 🍕 🌭 🥪 🌮 🌯 🫔 🥙 🧆 🥚 🍳
🥘 🍲 🫕 🥣 🥗 🍿 🧈 🧂 🥫 🍱 🍘 🍙 🍚 🍛 🍜 🍝 🍠 🍢 🍣 🍤 🍥 🥮 🍡 🥟 🥠 🥡 🦀 🦞 🦐 🦑 🦪
🍦 🍧 🍨 🍩 🍪 🎂 🍰 🧁 🥧 🍫 🍬 🍭 🍮 🍯 🍼 🥛 ☕ 🫖 🍵 🍶 🍾 🍷 🍸 🍹 🍺 🍻 🥂 🥃 🫗 🥤 🧋
🧃 🧉 🧊 🥢 🍽 🍴 🥄 🔪 🫙 🏺
"""),
    ("activities", "Aktiviteter & sport", """
🎃 🎄 🎆 🎇 🧨 ✨ 🎈 🎉 🎊 🎋 🎍 🎎 🎏 🎐 🎑 🧧 🎀 🎁 🎗 🎟 🎫 🎖 🏆 🏅 🥇 🥈 🥉
⚽ ⚾ 🥎 🏀 🏐 🏈 🏉 🎾 🥏 🎳 🏏 🏑 🏒 🥍 🏓 🏸 🥊 🥋 🥅 ⛳ ⛸ 🎣 🤿 🎽 🎿 🛷 🥌 🎯 🪀 🪁 🔫
🎱 🔮 🪄 🎮 🕹 🎰 🎲 🧩 🧸 🪅 🪩 🪆 ♠ ♥ ♦ ♣ ♟ 🃏 🀄 🎴 🎭 🖼 🎨 🧵 🪡 🧶 🪢
🎼 🎵 🎶 🎤 🎧 🎷 🪗 🎸 🎹 🎺 🎻 🪕 🥁 🪘 🪇 🪈
"""),
    ("travel", "Resor & platser", """
🚗 🚕 🚙 🚌 🚎 🏎 🚓 🚑 🚒 🚐 🛻 🚚 🚛 🚜 🦯 🦽 🦼 🛴 🚲 🛵 🏍 🛺 🚨 🚔 🚍 🚘 🚖 🛞 🚡 🚠 🚟
🚃 🚋 🚞 🚝 🚄 🚅 🚈 🚂 🚆 🚇 🚊 🚉 ✈ 🛫 🛬 🛩 💺 🛰 🚀 🛸 🚁 🛶 ⛵ 🚤 🛥 🛳 ⛴ 🚢 ⚓ 🛟 ⛽ 🚧
🚦 🚥 🚏 🗺 🗿 🗽 🗼 🏰 🏯 🏟 🎡 🎢 🎠 ⛲ ⛱ 🏖 🏝 🏜 🌋 ⛰ 🏔 🗻 🏕 ⛺ 🛖 🏠 🏡 🏘 🏚 🏗 🏭 🏢
🏬 🏣 🏤 🏥 🏦 🏨 🏪 🏫 🏩 💒 🏛 ⛪ 🕌 🕍 🛕 🕋 ⛩ 🛤 🛣 🗾 🎑 🏞 🌅 🌄 🌠 🎇 🎆 🌇 🌆 🏙 🌃 🌌
🌉 🌁 🧭 🕐 🕑 🕒 🕓 🕔 🕕 🕖 🕗 🕘 🕙 🕚 🕛
"""),
    ("objects", "Föremål", """
⌚ 📱 📲 💻 ⌨ 🖥 🖨 🖱 🖲 🕹 🗜 💽 💾 💿 📀 📼 📷 📸 📹 🎥 📽 🎞 📞 ☎ 📟 📠 📺 📻 🎙 🎚 🎛
⏱ ⏲ ⏰ 🕰 ⌛ ⏳ 📡 🔋 🪫 🔌 💡 🔦 🕯 🪔 🧯 🛢 💸 💵 💴 💶 💷 🪙 💰 💳 🧾 💎 ⚖ 🪜 🧰 🪛 🔧 🔨
⚒ 🛠 ⛏ 🪚 🔩 ⚙ 🪤 🧱 ⛓ 🧲 🔫 💣 🧨 🪓 🔪 🗡 ⚔ 🛡 🚬 ⚰ 🪦 ⚱ 🏺 🔮 📿 🧿 🪬 💈 ⚗ 🔭 🔬 🕳
🩹 🩺 🩻 🩼 💊 💉 🩸 🧬 🦠 🧫 🧪 🌡 🧹 🪠 🧺 🧻 🚽 🚰 🚿 🛁 🛀 🧼 🪥 🪒 🧽 🪣 🧴 🛎 🔑 🗝 🚪
🪑 🛋 🛏 🛌 🧸 🪆 🖼 🪞 🪟 🛍 🛒 🎁 🎈 🎏 🎀 🪄 🪅 🎊 🎉 🪩 🎎 🏮 🎐 🧧 ✉ 📩 📨 📧 💌 📥 📤
📦 🏷 🪧 📪 📫 📬 📭 📮 📯 📜 📃 📄 📑 🧾 📊 📈 📉 🗒 🗓 📆 📅 🗑 📇 🗃 🗳 🗄 📋 📁 📂 🗂
🗞 📰 📓 📔 📒 📕 📗 📘 📙 📚 📖 🔖 🧷 🔗 📎 🖇 📐 📏 🧮 📌 📍 ✂ 🖊 🖋 ✒ 🖌 🖍 📝 ✏ 🔍 🔎
🔏 🔐 🔒 🔓 👓 🕶 🥽 🥼 🦺 👔 👕 👖 🧣 🧤 🧥 🧦 👗 👘 🥻 🩱 🩲 🩳 👙 👚 🪭 👛 👜 👝 🎒 🩴 👞 👟
🥾 🥿 👠 👡 🩰 👢 🪮 👑 👒 🎩 🎓 🧢 🪖 ⛑ 📿 💄 💍 💼
"""),
    ("symbols", "Symboler", """
✅ ❌ ❎ ✔ ☑ ➕ ➖ ➗ ✖ 🟰 ♾ ‼ ⁉ ❓ ❔ ❕ ❗ 〰 💱 💲 ⚕ ♻ ⚜ 🔱 📛 🔰 ⭕ ✳ ✴ ❇ ©
® ™ 🔟 🔠 🔡 🔢 🔣 🔤 🅰 🆎 🅱 🆑 🆒 🆓 ℹ 🆔 Ⓜ 🆕 🆖 🅾 🆗 🅿 🆘 🆙 🆚 🈁 🈂 🈷 🈶 🈯 🉐
🈹 🈚 🈲 🉑 🈸 🈴 🈳 ㊗ ㊙ 🈺 🈵 🔴 🟠 🟡 🟢 🔵 🟣 🟤 ⚫ ⚪ 🟥 🟧 🟨 🟩 🟦 🟪 🟫 ⬛ ⬜ ◼ ◻ ◾
◽ ▪ ▫ 🔶 🔷 🔸 🔹 🔺 🔻 💠 🔘 🔳 🔲 🏧 🚮 🚰 ♿ 🚹 🚺 🚻 🚼 🚾 🛂 🛃 🛄 🛅 ⚠ 🚸 ⛔ 🚫 🚳 🚭
🚯 🚱 🚷 📵 🔞 ☢ ☣ ⬆ ↗ ➡ ↘ ⬇ ↙ ⬅ ↖ ↕ ↔ ↩ ↪ ⤴ ⤵ 🔃 🔄 🔙 🔚 🔛 🔜 🔝 🛐 ⚛ 🕉 ✡ ☸ ☯
✝ ☦ ☪ ☮ 🕎 🔯 🪯 ♈ ♉ ♊ ♋ ♌ ♍ ♎ ♏ ♐ ♑ ♒ ♓ ⛎ 🔀 🔁 🔂 ▶ ⏩ ⏭ ⏯ ◀ ⏪ ⏮ 🔼 ⏫ 🔽 ⏬ ⏸
⏹ ⏺ ⏏ 🎦 🔅 🔆 📶 🛜 📳 📴 ♀ ♂ ⚧ ✖ 🔇 🔈 🔉 🔊 📢 📣 📯 🔔 🔕 💬 💭 🗯 ♨ 🏁 🚩 🎌 🏴 🏳 🏳‍🌈 🏳‍⚧️ 🏴‍☠️
"""),
]

FLAGS = """
SE FI NO DK IS EE LV LT DE FR GB IE NL BE LU AT CH IT ES PT PL CZ SK HU RO BG GR HR SI
UA US CA MX BR AR CL CO PE JP CN KR IN AU NZ ZA EG TR IL SA AE SG TH VN ID PH MY KE NG MA
EU UN
"""

# Handgjorda namn för sekvenser som unicodedata inte kan slå upp.
SEQ_NAMES = {
    "👁‍🗨": "eye in speech bubble",
    "🐕‍🦺": "service dog",
    "🐈‍⬛": "black cat",
    "🐻‍❄️": "polar bear",
    "🐦‍⬛": "black bird",
    "🏳‍🌈": "rainbow flag pride",
    "🏳‍⚧️": "transgender flag",
    "🏴‍☠️": "pirate flag",
    # Unicode 15 (nyare än Pythons unicodedata 14.0):
    "🩷": "pink heart", "🩵": "light blue heart", "🩶": "grey heart", "🫨": "shaking face",
    "🫷": "leftwards pushing hand", "🫸": "rightwards pushing hand", "🫎": "moose", "🫏": "donkey",
    "🪽": "wing", "🪿": "goose", "🪼": "jellyfish", "🪻": "hyacinth", "🫚": "ginger root",
    "🫛": "pea pod", "🪭": "folding hand fan", "🪮": "hair pick", "🪇": "maracas", "🪈": "flute",
    "🛜": "wireless", "🪯": "khanda",
}

# Svenska sökord för de vanligaste — så "hjärta", "tummen upp", "fest" träffar.
SWEDISH = {
    "😀": "glad leende", "😂": "skratt gråter", "🤣": "skratt", "😊": "glad rodnar", "😍": "kär hjärtan",
    "🥰": "kär förälskad", "😎": "cool solglasögon", "🤔": "tänker fundersam", "😅": "svettig lättad",
    "🙏": "tack ber händer", "👍": "tummen upp bra", "👎": "tummen ner", "👏": "applåd klappar",
    "🙌": "hurra händer upp", "💪": "stark muskel", "👋": "hej vinkar hallå", "🤝": "handslag samarbete",
    "✌": "seger fred", "🤞": "hoppas korsade fingrar", "👀": "ögon tittar", "❤": "hjärta kärlek röd",
    "💙": "blått hjärta", "💚": "grönt hjärta", "💛": "gult hjärta", "💜": "lila hjärta", "🧡": "orange hjärta",
    "🖤": "svart hjärta", "🤍": "vitt hjärta", "💔": "krossat hjärta", "🔥": "eld het", "✨": "gnistrar glitter",
    "⭐": "stjärna", "🌟": "stjärna glöd", "🎉": "fest konfetti fira", "🎊": "konfetti fest", "🎈": "ballong",
    "🎂": "tårta födelsedag", "🍰": "tårta bakelse", "🥂": "skål champagne", "🍾": "champagne flaska",
    "☕": "kaffe fika", "🍕": "pizza", "🍔": "hamburgare", "🥗": "sallad", "🍎": "äpple", "🍓": "jordgubbe",
    "🚀": "raket lansering start", "💡": "idé lampa glödlampa", "📈": "tillväxt diagram uppåt",
    "📉": "diagram nedåt", "📊": "stapeldiagram statistik", "💰": "pengar säck", "💸": "pengar flyger",
    "💵": "sedlar dollar", "💳": "kort betalkort", "🏆": "pokal vinst", "🥇": "guld medalj första",
    "🎯": "måltavla mål träff", "✅": "bock klart check", "❌": "kryss fel", "⚠": "varning", "❗": "utrop viktigt",
    "❓": "fråga", "📌": "nål fäst", "📍": "plats kartnål", "📅": "kalender datum", "📆": "kalender",
    "⏰": "klocka alarm", "⏳": "timglas väntar", "📣": "megafon meddelande", "📢": "högtalare meddelande",
    "🔔": "klocka notis", "📝": "anteckning skriva", "📎": "gem bilaga", "📁": "mapp", "📂": "mapp öppen",
    "📄": "dokument sida", "📚": "böcker", "📖": "bok läsa", "🎓": "examen utbildning", "🧠": "hjärna",
    "💻": "dator laptop", "🖥": "skärm dator", "📱": "mobil telefon", "📧": "e-post mejl", "✉": "kuvert brev",
    "🔗": "länk", "🔑": "nyckel", "🔒": "lås låst", "🔓": "olåst", "⚙": "kugghjul inställningar",
    "🛠": "verktyg", "🔧": "skiftnyckel", "🧰": "verktygslåda", "🏠": "hus hem", "🏢": "kontor byggnad",
    "🌍": "jorden värld europa", "🌱": "planta grodd", "🌳": "träd", "🌸": "blomma körsbär", "🌻": "solros",
    "☀": "sol", "🌧": "regn", "❄": "snö snöflinga", "⛄": "snögubbe", "🌈": "regnbåge", "🎄": "julgran jul",
    "🎃": "halloween pumpa", "🐶": "hund", "🐱": "katt", "🦊": "räv", "🐻": "björn", "🐝": "bi", "🦋": "fjäril",
    "🚗": "bil", "🚲": "cykel", "✈": "flygplan", "🚆": "tåg", "🚌": "buss", "🇸🇪": "sverige svensk flagga",
    "🇫🇮": "finland", "🇳🇴": "norge", "🇩🇰": "danmark", "🇪🇺": "eu europa", "👩‍💻": "kvinna dator",
    "🤗": "kram", "🫶": "hjärta händer", "🤩": "starstruck wow", "😴": "sover trött", "🤒": "sjuk",
    "🤷": "vet inte rycker på axlarna", "🙋": "räcker upp handen", "💬": "pratbubbla chatt",
    "🗓": "kalender", "🕐": "klockan ett", "🧩": "pussel", "🎨": "palett design", "🎤": "mikrofon",
    "🎧": "hörlurar", "🎵": "musik not", "⚡": "blixt snabb", "💥": "smäll", "💯": "hundra",
    "🙈": "apa täcker ögonen", "🫠": "smälter", "🥳": "fest partyhatt", "😇": "ängel", "🤖": "robot ai",
    "🍀": "fyrklöver lycka", "🎁": "present gåva", "🛒": "kundvagn", "🏁": "målflagga",
}

# Emoji som får hudton (Emoji_Modifier_Base) — bara de vi listar under "people".
SKIN_TONE_BASES = set("""
👋 🤚 🖐 ✋ 🖖 🫱 🫲 🫳 🫴 🫷 🫸 👌 🤌 🤏 ✌ 🤞 🫰 🤟 🤘 🤙 👈 👉 👆 🖕 👇 ☝ 🫵 👍 👎 ✊ 👊 🤛 🤜
👏 🙌 🫶 👐 🤲 🤝 🙏 ✍ 💅 🤳 💪 🦵 🦶 👂 🦻 👃 👶 🧒 👦 👧 🧑 👱 👨 🧔 👩 🧓 👴 👵 🙍 🙎 🙅 🙆
💁 🙋 🧏 🙇 🤦 🤷 👮 🕵 💂 🥷 👷 🫅 🤴 👸 👳 👲 🧕 🤵 👰 🤰 🫃 🫄 🤱 👼 🎅 🤶 🦸 🦹 🧙 🧚 🧛 🧜
🧝 💆 💇 🚶 🧍 🧎 🏃 💃 🕺 🕴 🧖 🧗 🏇 🏂 🏌 🏄 🚣 🏊 ⛹ 🏋 🚴 🚵 🤸 🤽 🤾 🤹 🧘 🛀 🛌 👭 👫 👬 💏 💑
""".split())


def base_char(s: str) -> str:
    return s.replace("️", "")


SEQ_NAMES = {base_char(k): v for k, v in SEQ_NAMES.items()}


def display(s: str) -> str:
    raw = base_char(s)
    if len(raw) == 1:
        cp = ord(raw)
        if cp < 0x10000 or cp in TEXT_DEFAULT_SMP:
            return raw + "️"
        return raw
    return s


def name_of(s: str) -> str:
    raw = base_char(s)
    if raw in SEQ_NAMES:
        return SEQ_NAMES[raw]
    if len(raw) == 1:
        n = unicodedata.name(raw, "")
        if not n:
            n = SEQ_NAMES.get(raw, "")
        if not n:
            raise SystemExit(f"okänd emoji: U+{ord(raw):04X}")
        return n.lower().replace("_", " ")
    if len(raw) == 2 and all(0x1F1E6 <= ord(c) <= 0x1F1FF for c in raw):
        return "flag"
    raise SystemExit(f"saknar namn för sekvens: {raw!r} {[hex(ord(c)) for c in raw]}")


FLAG_NAMES = {
    "SE": "sverige sweden", "FI": "finland", "NO": "norge norway", "DK": "danmark denmark", "IS": "island iceland",
    "EE": "estland estonia", "LV": "lettland latvia", "LT": "litauen lithuania", "DE": "tyskland germany",
    "FR": "frankrike france", "GB": "storbritannien uk", "IE": "irland ireland", "NL": "nederländerna netherlands",
    "BE": "belgien belgium", "LU": "luxemburg", "AT": "österrike austria", "CH": "schweiz switzerland",
    "IT": "italien italy", "ES": "spanien spain", "PT": "portugal", "PL": "polen poland", "CZ": "tjeckien czechia",
    "SK": "slovakien slovakia", "HU": "ungern hungary", "RO": "rumänien romania", "BG": "bulgarien bulgaria",
    "GR": "grekland greece", "HR": "kroatien croatia", "SI": "slovenien slovenia", "UA": "ukraina ukraine",
    "US": "usa amerika united states", "CA": "kanada canada", "MX": "mexiko mexico", "BR": "brasilien brazil",
    "AR": "argentina", "CL": "chile", "CO": "colombia", "PE": "peru", "JP": "japan", "CN": "kina china",
    "KR": "sydkorea korea", "IN": "indien india", "AU": "australien australia", "NZ": "nya zeeland new zealand",
    "ZA": "sydafrika south africa", "EG": "egypten egypt", "TR": "turkiet turkey", "IL": "israel",
    "SA": "saudiarabien saudi arabia", "AE": "förenade arabemiraten uae", "SG": "singapore", "TH": "thailand",
    "VN": "vietnam", "ID": "indonesien indonesia", "PH": "filippinerna philippines", "MY": "malaysia",
    "KE": "kenya", "NG": "nigeria", "MA": "marocko morocco", "EU": "eu europeiska unionen europe", "UN": "fn un united nations",
}


def flag(code: str) -> str:
    return "".join(chr(0x1F1E6 + ord(c) - ord("A")) for c in code)


def build():
    groups = []
    seen = set()
    for gid, label, blob in GROUPS:
        items = []
        for tok in blob.split():
            key = base_char(tok)
            if key in seen:
                continue
            seen.add(key)
            entry = [display(tok), name_of(tok)]
            sv = SWEDISH.get(key)
            if sv:
                entry.append(sv)
            items.append(entry)
        groups.append({"id": gid, "label": label, "emoji": items})
    flags = []
    for code in FLAGS.split():
        flags.append([flag(code), f"flag {FLAG_NAMES[code]}"])
    groups.append({"id": "flags", "label": "Flaggor", "emoji": flags})
    return groups


def main():
    groups = build()
    total = sum(len(g["emoji"]) for g in groups)
    skin = sorted(SKIN_TONE_BASES, key=lambda s: ord(s[0]))
    out = Path(__file__).resolve().parents[1] / "src" / "lib" / "emoji" / "data.ts"
    lines = [
        "// GENERERAD FIL — kör `python3 apps/web/scripts/generate-emoji-data.py`.",
        f"// {total} emoji i {len(groups)} kategorier, namn ur Unicode (lokalt via unicodedata),",
        "// svenska sökord för de vanligaste. Ingen extern källa, ingen CDN (CLAUDE.md § 1).",
        "",
        "/** [tecken, engelskt namn, svenska sökord?] */",
        "export type EmojiEntry = readonly [string, string] | readonly [string, string, string];",
        "",
        "export interface EmojiGroup {",
        "  id: string;",
        "  label: string;",
        "  emoji: readonly EmojiEntry[];",
        "}",
        "",
        "export const EMOJI_GROUPS: readonly EmojiGroup[] = " + json.dumps(groups, ensure_ascii=False, separators=(",", ":")) + ";",
        "",
        "/** Emoji som kan få hudton (Emoji_Modifier_Base) — utan VS16. */",
        "export const SKIN_TONE_BASES: ReadonlySet<string> = new Set(" + json.dumps(skin, ensure_ascii=False, separators=(",", ":")) + ");",
        "",
    ]
    out.write_text("\n".join(lines), encoding="utf-8")
    print(f"skrev {out} ({total} emoji)")


if __name__ == "__main__":
    main()
