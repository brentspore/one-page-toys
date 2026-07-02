/* Gallery: tools-registry.json + search, category & tool-type filters, URL sync. */

function escapeHTML(str) {
  return String(str).replace(/[&<>"']/g, function (ch) {
    switch (ch) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return ch;
    }
  });
}

function badgeClassForStatus(status) {
  const s = String(status || "").toLowerCase();
  if (s === "beta") return "badge badge--beta";
  if (s === "experimental") return "badge badge--experimental";
  if (s === "live") return "badge badge--live";
  return "badge";
}

/** Safe GA4 event helper. */
function track(name, params) {
  try {
    if (typeof window.gtag === "function") window.gtag("event", name, params || {});
  } catch (e) {
    /* analytics is best-effort */
  }
}

/* Outbound-link analytics: partner badges, footer links, etc. (Tip jar tracks itself.) */
document.addEventListener("click", function (e) {
  const a = e.target.closest ? e.target.closest("a[href]") : null;
  if (!a || a.classList.contains("opt-tipjar")) return;
  const href = a.getAttribute("href") || "";
  if (/^https?:\/\//i.test(href) && a.host && a.host !== location.host) {
    track("outbound_click", {
      link_url: href,
      link_text: (a.textContent || "").trim().slice(0, 60)
    });
  }
});

/** Stable ordering for category chips and "sort by category". */
const CATEGORY_ORDER = ["utility", "game", "visual", "audio", "simulation", "wellness"];

const CATEGORY_LABELS = {
  utility: "Tools",
  game: "Games & play",
  visual: "Visual & color",
  audio: "Audio",
  simulation: "Physics & sim",
  wellness: "Wellness"
};

/**
 * Extra plain-language tokens for each tool-type tag so search matches how people type
 * ("check my colors", "pretty print json", "meeting cost") without stuffing the visible chips.
 */
const TYPE_NL_PHRASES = {
  "tongue-drum":
    "steel tongue drum tank drum hank drum handpan hang drum percussion instrument music play strike mallet pentatonic akebono zen meditation calm relaxing soothing ambient chill mindfulness singing bowl gongs make music melody",
  "kalimba":
    "kalimba thumb piano mbira instrument music play pluck tines pentatonic notes melody song calm relaxing dreamy glowing sky ambient chill zen soothing meditative harp bells celesta glissando make music",
  "jigsaw-puzzle":
    "jigsaw puzzle jigsaw interlocking pieces tab blank drag drop assemble picture puzzle image photo scene 3x3 4x4 5x5 solve reassemble snap together relax casual mind game brain teaser gallery scenes sunset mountains aurora night waves balloons",
  "slide-puzzle":
    "slide puzzle sliding puzzle slide tile puzzle 15 puzzle picture puzzle scramble shuffle image photo brain teaser rearrange pieces 3x3 4x4 5x5 solve reassemble relax casual mind game classic n-puzzle tiles gallery scenes sunset mountains aurora night",
  "wooly-willy":
    "magnetic face wooly willy woolly willy iron filings magnet magnetic wand drawing toy give him hair beard moustache mustache eyebrows bald cartoon face classic retro toy physics magnetism field lines shavings comb draw doodle silly funny kids nostalgia sketch",
  "gravity-orbits":
    "gravity orbits orbit planets star sun solar system space physics simulation n-body newtonian celestial mechanics slingshot elliptical trajectory fling planet asteroid galaxy cosmos astronomy sandbox merge collide trails satellites",
  "cloth":
    "cloth tear fabric verlet physics simulation banner flag curtain drape rip shred pull stretch swing wind ripple textile mesh soft body satisfying tactile cut hole sheet",
  "double-pendulum":
    "double pendulum chaos chaos theory chaotic physics simulation swing motion trails pendulum arm bob lagrangian nonlinear butterfly effect sensitive dependence hypnotic mesmerizing science math dynamics oscillation",
  "aurebesh-translator":
    "aurebesh translator aurebesh aurabesh star wars alphabet galactic basic writing system font glyphs transliterate translate decode decoder cipher secret message jedi sith empire rebel imperial datapad holocron type your name in aurebesh learn aurebesh star wars language sci-fi runes symbols characters letters mandalorian aurek besh decrypt encode share fun nerdy fandom geek",
  "pottery-wheel":
    "pottery wheel ceramics clay throwing throw a pot potter pot vase bowl vessel urn jar shape sculpt mold form spin spinning wheel kiln fire firing glaze glazed celadon cobalt oxblood finished piece reveal studio terracotta earthenware stoneware pull the walls 3d soft 3d surface of revolution calming relaxing meditative satisfying zen wellness ASMR craft make handmade ghost pottery scene drag to shape interactive",
  "chladni-plate":
    "chladni plate cymatics sand vibration resonance standing waves nodal lines nodal pattern frequency modes faster slower pause drop sand control physics simulation vibrating plate sand figures acoustic patterns harmonics sound made visible faraday waves resonant frequencies particles settle science experiment generative mesmerizing satisfying black and white visual",
  "pin-art":
    "pin art pinscreen pin screen pin board metal pins impression toy 3d pin impression desk toy fidget tactile relief draw drawing sketch sculpt press and drag follow your hand mouse cursor pins rise push erase clear hand mold pin point impression sculpture interactive visual satisfying executive toy office toy classic toy",
  "perfect-circle":
    "perfect circle draw a circle freehand round roundness accuracy score percent percentage how round can you draw test skill precision steady hand challenge addictive viral one stroke beat your best high score leaderboard chase 100 game reflex satisfying heat map deviation neal fun ese",
  "rain-window":
    "rain on a window foggy glass condensation raindrops drops slide trickle wipe the fog clear the glass bokeh city lights warm cozy rainy night thunder storm ambient asmr relaxing calm meditative soothing lo-fi study chill wellness sound synthesis generative",
  "fireworks":
    "fireworks firework shells rockets sparks bursts explosions pyrotechnics night sky tap to launch celebration new year fourth of july july 4th diwali bonfire night boom crackle whistle reflection water lake colorful festive peony willow ring chrysanthemum visual ambient generative sound synthesis",
  "campfire":
    "campfire camp fire bonfire fire flames crackle crackling logs wood embers sparks cozy warm night relaxing ambient asmr fireplace tend the fire add a log fan the flames glow heat soothing calm meditative wellness sound synthesis generative",
  "aurora-drift":
    "aurora drift northern lights aurora borealis polar lights night sky stars curtains ribbons green violet teal shimmer paint drag mountains snowy peaks relaxing ambient meditative calm wellness peaceful soothing hypnotic glow",
  "floating-lanterns":
    "floating lanterns sky lantern paper lantern release light festival yi peng loy krathong wishes night lake water moon stars reflection calm relaxing meditative ambient zen peaceful soothing tranquil glow drift float rise tap to release memorial remembrance",
  "zen-sand-garden":
    "zen sand garden japanese rock garden karesansui raking rake sand lines patterns stones pebbles rocks meditative mindfulness calm relaxing ambient peaceful soothing tranquil tabletop desk zen drag to rake tap to place stone furrows ripples sandbox",
  "marble-drop":
    "marble drop marbles plinko pachinko galton board bean machine pegboard pegs bounce drop balls glass marbles bins slots physics satisfying clack falling balls probability bell curve gravity arcade pinball tap to drop",
  "wind-chimes":
    "wind chimes windchimes chimes hanging tubes bells breeze wind tinkle ring tone pentatonic calm relaxing meditative ambient zen garden patio porch metal bronze tubular bells clapper sail tap to ring soothing peaceful gentle melody music sound",
  "ripple-pond":
    "zen ripple pond water ripples raindrops pool tap the water interference waves moonlit moon koi fish lily pads lotus calm relaxing meditative ambient zen garden japanese still pond surface tension drop splash concentric rings reflection night soothing tranquil",
  "kaleidoscope":
    "kaleidoscope kaleidescope mirror symmetry mandala jewel gems shards glass chips stained glass mirrored pattern hypnotic mesmerizing spin stir twist colorful symmetrical generative meditative relaxing ambient drag tap interactive shifting snowflake radial",
  "plasma-ball":
    "plasma ball plasma globe plasma lamp electric arcs lightning ball tesla coil neon discharge glass sphere electrode glowing tentacles touch finger interactive electric dark room science sci-fi zap crackle lightning plasma electric blue purple",
  "spirograph":
    "spirograph string art hypotrochoid epitrochoid geometric pattern petals rose curves mathematical art generative drawing bloom kaleidoscope spirals flowers mandala mesmerizing watch",
  "newtons-cradle":
    "newtons cradle newton cradle balls pendulum physics momentum transfer clack kinetic energy elastic collision stress wave desk toy swing tick tock satisfying hypnotic",
  "bubble-wrap":
    "bubble wrap pop bubbles popping asmr satisfying stress relief pop it fidget sensory tap click drag sheet reset calm anxiety zen tactile",
  "lava-lamp":
    "lava lamp metaballs blobs ambient relaxing hypnotic chill retro fluid simulation rise drift float merge wave slow satisfying screensaver 70s groovy warm orange",
  "falling-sand":
    "falling sand game powder toy cellular automaton sandbox simulation physics sand water fire plant oil stone draw elements materials burn flow melt pixel zen satisfying noita powder game",
  "beat-maker":
    "beat maker step sequencer drum machine make music loop rhythm beats grid tap groove melody synth tempo bpm pattern create song producer audio play instrument",
  "chimp-test":
    "chimp test chimpanzee memory working memory number sequence grid brain training cognitive human benchmark ayumu numbers order recall concentration mental focus iq test smarter than a chimp",
  "sequence-memory":
    "echo simon says sequence memory pattern game lights sounds tones repeat the pattern brain training memory game concentration audio visual recall colors pads how far can you remember",
  "idle-garden":
    "tiny idle garden gardening grow flowers plant seeds bloom cozy clicker incremental idle game zen relaxing day night cycle fireflies water plants nature calm passive offline grows while away farm",
  "star-sky":
    "star click sky stars night sky cosmos space constellation twinkle shooting star nebula galaxy relaxing ambient draw stargazing universe",
  "tic-tac-toe":
    "tic tac toe noughts and crosses xs and os x o board game two player vs computer ai minimax unbeatable strategy grid",
  "gesture-game":
    "rock paper scissors roshambo hand game vs computer throw win lose tie streak best of decide",
  "monty-hall":
    "monty hall problem three doors game show goat prize switch or stay probability statistics 2/3 puzzle brain teaser",
  "memory-game":
    "memory match concentration pairs matching cards flip remember brain game emoji grid focus",
  "snake-game":
    "snake game classic arcade nokia eat grow apple high score arrows wasd retro grid neon",
  "generative-art":
    "generative art procedural creative coding flow field harmonograph particle swarm kaleidoscope canvas screensaver abstract pattern palette make art save png",
  "dice-roller":
    "dice roller roll die d4 d6 d8 d10 d12 d20 polyhedral rpg tabletop dnd dungeons dragons board game random number pool sum total fair",
  "fortune-toy":
    "magic 8 ball eight ball fortune teller yes no question shake answer oracle prophecy decision predict future ask",
  "synth-toy":
    "blob choir synth synthesizer ambient music sound instrument tap drag pad drone generative noise relax play tones voices",
  "coin-flip":
    "coin flip flipper toss heads or tails 50 50 fifty fifty decide decision random chance fair odds streak gold coin spin call it",
  "breathing-tool":
    "breathing pacer breath guide box breathing 4-7-8 478 inhale exhale calm relax relaxation meditation mindfulness anxiety stress focus pranayama slow deep breaths timer wellness",
  "cost-calculator":
    "meeting cost calculator timer money burn rate how much does this meeting cost salary hourly per person dollars wage expensive standup live counter ticker",
  "countdown-timer":
    "countdown timer days until how many days till event birthday christmas new year vacation trip wedding launch deadline weekend clock ticking down share link until the big day time left remaining",
  "sleep-calculator":
    "sleep cycle calculator bedtime wake up time alarm when should i go to bed 90 minute cycles rem refreshed groggy nap rest tired how much sleep best time to wake insomnia schedule",
  "wage-timer":
    "time is money hourly wage salary earnings live counter ticker what am i earning per second minute how many hours of work does this cost purchase price worth it your time paycheck",
  "age-counter":
    "life in numbers age calculator birthday how old am i seconds alive heartbeats breaths days lived trips around the sun full moons next birthday countdown live ticker mortality time",
  "savings-calculator":
    "latte factor daily habit cost coffee cigarettes subscription savings compound interest invested at 7 percent yearly total how much do i spend money awareness budget quit",
  "reaction-game":
    "reaction reflex timing wait green click milliseconds ms latency benchmark test skill speed measure",
  "snake-game":
    "snake classic arcade eat tail grid keyboard wasd arrows retro move hunger",
  "palette-browser":
    "palette color colours swatch scheme explore vibe hue hex rgb designer export choose sample",
  "generative-art":
    "generative procedural art pattern random canvas animation motion creative screensaver abstract algorithm",
  "mesh-gradient-builder":
    "mesh gradient hero background css stylesheet blob radial design landing soft ui export code snippet",
  "coin-simulator":
    "coin flip heads tails random decide choose fifty chance fair streak toss call binary",
  "typing-test":
    "typing typist wpm words per minute speed keyboard practice benchmark sprint accuracy race skill",
  "memory-game":
    "memory match pairs cards flip remember concentration puzzle emoji grid recall find",
  "tic-tac-toe":
    "tic tac toe noughts crosses board grid xs os xsandos strategy classic three row column diagonal opponent",
  "unbeatable-ai":
    "perfect impossible optimal minimax computer ai opponent draw win never lose best play algorithm",
  "oracle-toy":
    "oracle prophecy wisdom void absurd surreal cosmic consult joke nonsense sphere purple random answer",
  "synth-toy":
    "music sound audio synthesizer synth tone instrument tap play choir noise fun ear experimental",
  "dice-roller":
    "dice roll d4 d6 d8 d10 d12 d20 tabletop rpg board random polyhedral rng history statistic",
  "slot-machine":
    "slot machine reels spin jackpot casino gamble luck emoji three match pull vegas",
  "phrase-generator":
    "compliment praise wholesome nice random funny fire cannon keyboard shortcut space rapid wholesome absurd",
  "fortune-toy":
    "magic eight ball shake destiny future mystical yes no question answer cloudy triangle toy decision",
  "gesture-game":
    "rock paper scissors roshambo rps hand throw beat versus win loss tie score random opponent",
  "excuse-generator":
    "excuse late sorry calendar meeting blame plausible funny reason story entropy apology alibi",
  "tap-challenge":
    "mash button tap click spam finger fastest hurry frantic seconds endurance score hurry drill",
  "pixel-editor":
    "pixel art grid draw doodle toggle bitmap sprite low resolution small squares design glyph",
  "starfield-toy":
    "star stars sky night twinkle click universe constellation ambient peaceful wallpaper sparkle galaxy",
  "novelty-meter":
    "banana slider gauge silly joke absurd meter useless science fruit scale humor satire",
  "odd-one-out":
    "odd different impostor spot find emoji four three match same puzzle which one unlike different quiz streak",
  "breathing-guide":
    "breathing breath calm anxiety relax inhale exhale box pacing meditation mindfulness stress wellness guide visual circle timing",
  "door-game":
    "door doors choice mystery reveal star goat three pick guess hide prize surprise pickone monty probability",
  "clipboard-tool": "clipboard snippets copy paste stack save pin label notes local storage multiple items",
  "diff-tool": "diff compare text unified lines changes patch git style paste two versions",
  "regex-tool": "regex regular expression pattern flags replace match test javascript",
  "id-generator": "uuid nanoid random id bulk identifiers unique tokens",
  "time-tool": "timestamp unix iso timezone convert utc epoch seconds date formatter",
  "data-converter": "csv json comma delimiter header rows export import spreadsheet",
  "encoder-tool": "base64 encode decode url encodeURIComponent atob btoa",
  "jwt-tool": "jwt token decode payload header bearer exp expiry json web",
  "palette-extractor": "palette swatches image photo colors css variables extract designer",
  "gradient-tool": "linear gradient angle css background stops colors",
  "icon-tool": "favicon png icon sizes download resize 32 16 apple touch",
  "image-tool": "image compress jpeg quality canvas download smaller file size",
  "markdown-tool": "markdown preview html heading list bold render writer",
  "seo-tool": "open graph meta tags twitter card og:title og:description og:image",
  "a11y-tool": "accessibility checklist wcag keyboard contrast labels aria",
  "unit-tool": "px rem em conversion root font scale spacing design token",
  "notes-tool": "meeting notes log timestamp timer export markdown minutes",
  "copy-tool": "ux copy microcopy button label empty state error message tone",
  "hash-tool": "sha256 sha1 digest checksum file hash crypto integrity",
  "json-tool": "json schema validate object array required properties",
  "math-tool": "percentage percent ratio fraction calculate proportion discount tip interest share of total",
  "qr-tool": "qr code barcode scannable link url phone camera download png matrix",
  "word-count-tool": "word count characters letters sentences paragraphs essay tweet limit paste clipboard writing",
  "prompt-toy": "daily prompt doodle creative streak sketch idea drawing",
  "idle-toy": "idle garden grow water tap playful progress save",
  "mood-toy": "mood sky gradient pick log feelings diary",
  "rhythm-toy": "tap rhythm beat bpm metronome timing accuracy score"
};

const SEARCH_STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "to",
  "for",
  "of",
  "in",
  "on",
  "at",
  "by",
  "with",
  "from",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "could",
  "should",
  "i",
  "you",
  "we",
  "they",
  "it",
  "this",
  "that",
  "these",
  "those",
  "my",
  "your",
  "our",
  "their",
  "me",
  "us",
  "what",
  "which",
  "who",
  "whom",
  "whose",
  "where",
  "when",
  "why",
  "how",
  "if",
  "or",
  "as",
  "so",
  "than",
  "too",
  "very",
  "just",
  "only",
  "own",
  "same",
  "such",
  "also",
  "both",
  "few",
  "more",
  "most",
  "other",
  "some",
  "no",
  "nor",
  "not",
  "but",
  "and",
  "can",
  "may",
  "might",
  "must",
  "shall",
  "want",
  "needs",
  "need",
  "get",
  "got",
  "make",
  "made",
  "using",
  "use",
  "used",
  "find",
  "free",
  "online",
  "tool",
  "page",
  "app",
  "help",
  "like",
  "into",
  "about",
  "over",
  "after",
  "before",
  "between",
  "through",
  "during",
  "any",
  "all",
  "every",
  "another",
  "am",
  "im",
  "ive",
  "dont",
  "doesnt",
  "didnt",
  "wont",
  "cant",
  "let",
  "out",
  "up",
  "down",
  "way"
]);

let allTools = [];
let activeTag = "";
let activeCategory = "";
let knownTags = [];
let knownCategories = [];
let galleryMode = "all";
let homeFeatured = null;
let newestTool = null;

function shuffleInPlace(arr, rand) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor((rand ? rand() : Math.random()) * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

function buildTagSearchHay(tags) {
  if (!Array.isArray(tags) || !tags.length) return "";
  const chunks = [];
  tags.forEach(function (t) {
    const tl = String(t).toLowerCase();
    chunks.push(tl);
    chunks.push(tl.replace(/-/g, " "));
    const nl = TYPE_NL_PHRASES[tl];
    if (nl) chunks.push(nl);
  });
  return chunks.join(" ");
}

function normalizeHaystack(tool) {
  const cat = String(tool.category || "").toLowerCase();
  const catLabel =
    cat && CATEGORY_LABELS[cat] ? String(CATEGORY_LABELS[cat]).toLowerCase() : "";
  const parts = [
    tool.name,
    tool.shortDescription,
    tool.slug,
    tool.slug ? tool.slug.replace(/-/g, " ") : "",
    tool.status,
    cat,
    catLabel,
    buildTagSearchHay(Array.isArray(tool.tags) ? tool.tags : [])
  ];
  return parts
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function splitHayWords(hay) {
  return hay.split(/[^a-z0-9]+/).filter(function (w) {
    return w.length > 0;
  });
}

/** Substring match, or prefix match on any word (e.g. "typ" → typing). */
function tokenMatchesHaystack(tok, hay) {
  if (!tok.length) return true;
  if (hay.indexOf(tok) !== -1) return true;
  if (tok.length < 2) return false;
  const words = splitHayWords(hay);
  return words.some(function (w) {
    return w.indexOf(tok) === 0;
  });
}

function toolMatchesSearch(tool, tokens) {
  if (!tokens.length) return true;
  const hay = normalizeHaystack(tool);
  return tokens.every(function (tok) {
    return tokenMatchesHaystack(tok, hay);
  });
}

function toolMatchesTag(tool) {
  if (!activeTag) return true;
  const tags = Array.isArray(tool.tags) ? tool.tags : [];
  return tags.some(function (t) {
    return String(t).toLowerCase() === activeTag;
  });
}

function toolMatchesCategory(tool) {
  if (!activeCategory) return true;
  return String(tool.category || "").toLowerCase() === activeCategory;
}

function getSearchTokens() {
  const el = document.getElementById("toolsSearch");
  const raw = (el && el.value) || "";
  const lowered = raw.trim().toLowerCase();
  const split = lowered.split(/[\s,;]+/).filter(Boolean);
  const cleaned = split
    .map(function (t) {
      return t.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "");
    })
    .filter(function (t) {
      return t.length > 0;
    });
  const unstopped = cleaned.filter(function (t) {
    return !SEARCH_STOP_WORDS.has(t);
  });
  const meaningful = unstopped.length > 0 ? unstopped : cleaned;
  return meaningful.filter(function (t) {
    return t.length >= 2 || /^\d+$/.test(t);
  });
}

function getFilteredTools() {
  const tokens = getSearchTokens();
  return allTools.filter(function (tool) {
    return (
      toolMatchesCategory(tool) &&
      toolMatchesTag(tool) &&
      toolMatchesSearch(tool, tokens)
    );
  });
}

function sortToolsForDisplay(tools) {
  const sortEl = document.getElementById("toolsSort");
  const sortMode = sortEl && sortEl.value === "category" ? "category" : "name";
  const slice = tools.slice();
  if (sortMode === "category") {
    slice.sort(function (a, b) {
      const ca = String(a.category || "").toLowerCase();
      const cb = String(b.category || "").toLowerCase();
      const ia = CATEGORY_ORDER.indexOf(ca);
      const ib = CATEGORY_ORDER.indexOf(cb);
      const sa = ia === -1 ? 999 : ia;
      const sb = ib === -1 ? 999 : ib;
      if (sa !== sb) return sa - sb;
      return String(a.name || "").localeCompare(String(b.name || ""));
    });
  } else {
    slice.sort(function (a, b) {
      return String(a.name || "").localeCompare(String(b.name || ""));
    });
  }
  return slice;
}

function collectTagsFromTools(tools) {
  const set = new Set();
  tools.forEach(function (t) {
    (Array.isArray(t.tags) ? t.tags : []).forEach(function (tag) {
      set.add(String(tag).toLowerCase());
    });
  });
  return Array.from(set).sort(function (a, b) {
    return a.localeCompare(b);
  });
}

function collectCategoriesFromTools(tools) {
  const set = new Set();
  tools.forEach(function (t) {
    const c = String(t.category || "").toLowerCase();
    if (c) set.add(c);
  });
  return Array.from(set).sort(function (a, b) {
    const ia = CATEGORY_ORDER.indexOf(a);
    const ib = CATEGORY_ORDER.indexOf(b);
    const sa = ia === -1 ? 999 : ia;
    const sb = ib === -1 ? 999 : ib;
    if (sa !== sb) return sa - sb;
    return a.localeCompare(b);
  });
}

function formatTagLabel(tag) {
  return String(tag || "")
    .split("-")
    .filter(Boolean)
    .map(function (w) {
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(" ");
}

function syncURL() {
  const qEl = document.getElementById("toolsSearch");
  const q = (qEl && qEl.value.trim()) || "";
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (activeTag) params.set("tag", activeTag);
  if (activeCategory) params.set("cat", activeCategory);
  const sortEl = document.getElementById("toolsSort");
  if (sortEl && sortEl.value === "category") params.set("sort", "category");
  const qs = params.toString();
  const path = location.pathname;
  const hash = location.hash || "";
  const next = qs ? path + "?" + qs + hash : path + hash;
  if (next !== path + location.search + hash) {
    history.replaceState(null, "", next);
  }
}

function readFiltersFromURL() {
  let q = "";
  let tag = "";
  let cat = "";
  let sort = "";
  try {
    const p = new URLSearchParams(location.search);
    q = p.get("q") || "";
    tag = (p.get("tag") || "").toLowerCase().trim();
    cat = (p.get("cat") || "").toLowerCase().trim();
    sort = (p.get("sort") || "").toLowerCase().trim();
  } catch (e) {
    /* ignore */
  }
  return { q, tag, cat, sort };
}

function syncTypesFilterDetails() {
  const det = document.getElementById("toolsFilterTypes");
  if (!det) return;
  det.open = Boolean(activeTag);
}

function syncTypesFilterSummary() {
  const picked = document.getElementById("toolsTypesActiveSummary");
  if (!picked) return;
  if (activeTag) {
    picked.hidden = false;
    picked.textContent = formatTagLabel(activeTag);
  } else {
    picked.hidden = true;
    picked.textContent = "";
  }
}

function renderTagChips() {
  const wrap = document.getElementById("toolsTags");
  if (!wrap) return;

  const hint = document.getElementById("toolsTypesHint");
  if (hint) {
    hint.textContent = knownTags.length ? knownTags.length + " types" : "";
  }

  wrap.innerHTML = "";

  function addChip(label, value, pressed) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tools-tag";
    btn.textContent = label;
    btn.setAttribute("data-tag", value);
    btn.setAttribute("aria-pressed", pressed ? "true" : "false");
    btn.addEventListener("click", function () {
      activeTag = value;
      renderTagChips();
      applyFilters();
    });
    wrap.appendChild(btn);
  }

  addChip("All", "", activeTag === "");
  knownTags.forEach(function (t) {
    addChip(formatTagLabel(t), t, activeTag === t);
  });

  syncTypesFilterDetails();
  syncTypesFilterSummary();
}

function renderCategoryChips() {
  const wrap = document.getElementById("toolsCategories");
  if (!wrap) return;
  wrap.innerHTML = "";

  // count how many toys sit in each category so each chip shows its size
  const counts = {};
  allTools.forEach(function (t) {
    const c = String(t.category || "").toLowerCase();
    if (c) counts[c] = (counts[c] || 0) + 1;
  });

  function addChip(label, value, count, pressed) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tools-tag tools-tag--category";
    btn.setAttribute("data-category", value);
    btn.setAttribute("aria-pressed", pressed ? "true" : "false");
    btn.appendChild(document.createTextNode(label));
    const n = document.createElement("span");
    n.className = "tools-tag__n";
    n.textContent = String(count);
    btn.appendChild(n);
    btn.addEventListener("click", function () {
      activeCategory = value;
      renderCategoryChips();
      applyFilters();
    });
    wrap.appendChild(btn);
  }

  addChip("All", "", allTools.length, activeCategory === "");
  knownCategories.forEach(function (c) {
    const label = CATEGORY_LABELS[c] || formatTagLabel(c);
    addChip(label, c, counts[c] || 0, activeCategory === c);
  });
}

function updateClearButton() {
  const btn = document.getElementById("toolsClearFilters");
  const qEl = document.getElementById("toolsSearch");
  if (!btn || !qEl) return;
  const hasQ = qEl.value.trim().length > 0;
  const hasTag = activeTag.length > 0;
  const hasCat = activeCategory.length > 0;
  btn.hidden = !hasQ && !hasTag && !hasCat;
}

function updateMeta(filteredCount, total) {
  const meta = document.getElementById("toolsMeta");
  if (!meta) return;
  const tokens = getSearchTokens();
  const filtered =
    filteredCount !== total || tokens.length > 0 || activeTag || activeCategory;
  if (total === 0) {
    meta.textContent = "No toys yet";
    return;
  }
  if (filtered) {
    meta.textContent =
      filteredCount === total
        ? "Showing all " + total
        : "Showing " + filteredCount + " of " + total;
  } else {
    meta.textContent = total === 1 ? "1 toy" : total + " toys";
  }
}

// ---- card rendering + infinite scroll ------------------------------------
const PAGE_SIZE = 12;
let _pageItems = [];
let _pageShown = 0;
let _scrollObserver = null;

function createCard(tool) {
  const card = document.createElement("a");
  card.className = "card";
  card.href = tool.path || "#";

  // Static preview thumbnail — a still glimpse of the toy (CSS-rendered per slug).
  const preview = document.createElement("div");
  preview.className = "card__preview";
  preview.setAttribute("aria-hidden", "true");
  if (tool.slug) preview.dataset.slug = tool.slug;
  card.appendChild(preview);

  const cardTop = document.createElement("div");
  cardTop.className = "card__top";

  const h3Wrap = document.createElement("div");
  h3Wrap.className = "card__title-stack";
  const h3 = document.createElement("h3");
  h3.textContent = tool.name || tool.slug || "Untitled";
  h3Wrap.appendChild(h3);

  const catKey = String(tool.category || "").toLowerCase();
  if (catKey && CATEGORY_LABELS[catKey]) {
    const catLine = document.createElement("p");
    catLine.className = "card__category";
    catLine.textContent = CATEGORY_LABELS[catKey];
    h3Wrap.appendChild(catLine);
  }

  const status = document.createElement("span");
  status.className = badgeClassForStatus(tool.status);
  status.textContent = String(tool.status || "experimental");

  cardTop.appendChild(h3Wrap);
  cardTop.appendChild(status);

  const desc = document.createElement("p");
  desc.textContent = tool.shortDescription || "";

  // (Per-card tag chips removed — each toy's only tag was its own slug, which
  // duplicated the title + category line above. Tags still power search via
  // buildTagSearchHay/TYPE_NL_PHRASES; they're just no longer shown as chips.)

  const cta = document.createElement("span");
  cta.className = "card__cta";
  cta.textContent = "Launch";

  card.appendChild(cardTop);
  card.appendChild(desc);
  card.appendChild(cta);

  if (!tool.path) {
    card.href = "#";
  } else {
    // Each toy launches into its own standalone experience in a new tab.
    card.target = "_blank";
    card.rel = "noopener noreferrer";
    card.addEventListener("click", function () {
      track("toy_launch", {
        toy_slug: tool.slug || "",
        toy_name: tool.name || "",
        toy_category: tool.category || "",
        source: "gallery"
      });
    });
  }

  return card;
}

// A zero-height marker right after the grid; when it scrolls into view we
// reveal the next page of cards.
function getScrollSentinel() {
  let s = document.getElementById("toolsScrollSentinel");
  if (!s) {
    const grid = document.getElementById("toolsGrid");
    if (!grid || !grid.parentNode) return null;
    s = document.createElement("div");
    s.id = "toolsScrollSentinel";
    s.className = "tools-scroll-sentinel";
    s.setAttribute("aria-hidden", "true");
    grid.parentNode.insertBefore(s, grid.nextSibling);
  }
  return s;
}

function ensureScrollObserver() {
  if (_scrollObserver || typeof IntersectionObserver === "undefined") return;
  const sentinel = getScrollSentinel();
  if (!sentinel) return;
  _scrollObserver = new IntersectionObserver(function (entries) {
    if (entries[0] && entries[0].isIntersecting) renderNextPage();
  }, { rootMargin: "700px 0px" });
  _scrollObserver.observe(sentinel);
}

function renderNextPage() {
  const grid = document.getElementById("toolsGrid");
  if (!grid) return;
  const end = Math.min(_pageShown + PAGE_SIZE, _pageItems.length);
  const frag = document.createDocumentFragment();
  for (let i = _pageShown; i < end; i++) frag.appendChild(createCard(_pageItems[i]));
  grid.appendChild(frag);
  _pageShown = end;

  const sentinel = document.getElementById("toolsScrollSentinel");
  const more = _pageShown < _pageItems.length;
  if (sentinel) sentinel.hidden = !more;
  // Keep filling until the sentinel is pushed past the preload threshold,
  // so short pages (few rows) don't strand undisplayed cards off-screen.
  if (more && sentinel && sentinel.getBoundingClientRect().top < window.innerHeight + 700) {
    requestAnimationFrame(renderNextPage);
  }
}

function renderCards(tools) {
  const grid = document.getElementById("toolsGrid");
  const errorEl = document.getElementById("toolsError");
  const emptyEl = document.getElementById("toolsEmpty");

  if (!grid) return;
  grid.innerHTML = "";

  if (emptyEl) {
    emptyEl.hidden = tools.length > 0;
  }

  const total = allTools.length;
  updateMeta(tools.length, total);

  _pageItems = tools;
  _pageShown = 0;

  if (!tools.length) {
    const sentinel = document.getElementById("toolsScrollSentinel");
    if (sentinel) sentinel.hidden = true;
    if (errorEl) errorEl.hidden = true;
    return;
  }

  ensureScrollObserver();
  renderNextPage();

  if (errorEl) errorEl.hidden = true;
}

function applyFilters() {
  if (galleryMode === "home") {
    if (!homeFeatured) {
      const pool = allTools.filter(function (t) {
        return t && t.path;
      });
      const shuffled = shuffleInPlace(pool.slice(), Math.random);
      homeFeatured = shuffled.slice(0, 9);
    }
    renderCards(homeFeatured);
    updateClearButton();
    return;
  }

  const filtered = sortToolsForDisplay(getFilteredTools());
  renderCards(filtered);
  updateClearButton();
  syncURL();
}

function validateActiveTag() {
  if (!activeTag) return;
  if (knownTags.indexOf(activeTag) === -1) activeTag = "";
}

function validateActiveCategory() {
  if (!activeCategory) return;
  if (knownCategories.indexOf(activeCategory) === -1) activeCategory = "";
}

function wireRandomButton() {
  ["randomToolBtn", "heroSurprise"].forEach(function (id) {
    const randomBtn = document.getElementById(id);
    if (!randomBtn) return;
    randomBtn.addEventListener("click", function () {
      const filtered = getFilteredTools().filter(function (t) {
        return t && t.path;
      });
      const pool = filtered.length ? filtered : allTools.filter(function (t) {
        return t && t.path;
      });
      if (!pool.length) return;
      const pick = pool[Math.floor(Math.random() * pool.length)];
      track("toy_launch", {
        toy_slug: pick.slug || "",
        toy_name: pick.name || "",
        toy_category: pick.category || "",
        source: "surprise_me"
      });
      window.open(pick.path, "_blank", "noopener");
    });
  });
}

// Home landing: fill the live toy count + spotlight the newest toy
function renderHomeHero() {
  if (galleryMode !== "home") return;
  const countEl = document.getElementById("heroCount");
  if (countEl) countEl.textContent = String(allTools.length);

  const sec = document.getElementById("homeFeatured");
  if (!sec || !newestTool || !newestTool.path) return;
  const t = newestTool;
  const nameEl = document.getElementById("featuredName");
  const catEl = document.getElementById("featuredCat");
  const descEl = document.getElementById("featuredDesc");
  const linkEl = document.getElementById("featuredLink");
  const mediaEl = document.getElementById("featuredMedia");
  const prev = document.getElementById("featuredPreview");

  if (nameEl) nameEl.textContent = t.name || t.slug || "";
  const catKey = String(t.category || "").toLowerCase();
  if (catEl) catEl.textContent = CATEGORY_LABELS[catKey] || "";
  if (descEl) descEl.textContent = t.shortDescription || "";
  if (prev && t.slug) prev.dataset.slug = t.slug;

  function go() {
    track("toy_launch", {
      toy_slug: t.slug || "",
      toy_name: t.name || "",
      toy_category: t.category || "",
      source: "home_featured"
    });
  }
  if (linkEl) { linkEl.href = t.path; linkEl.addEventListener("click", go); }
  if (mediaEl) {
    mediaEl.href = t.path;
    mediaEl.setAttribute("target", "_blank");
    mediaEl.setAttribute("rel", "noopener");
    mediaEl.addEventListener("click", go);
  }
  sec.hidden = false;
}

function wireSearchAndFilters() {
  const searchEl = document.getElementById("toolsSearch");
  const clearBtn = document.getElementById("toolsClearFilters");

  if (searchEl) {
    searchEl.addEventListener("input", function () {
      applyFilters();
    });
    searchEl.addEventListener("search", function () {
      applyFilters();
    });
    // "/" jumps to search (unless already typing somewhere); Esc clears + blurs
    document.addEventListener("keydown", function (e) {
      const t = e.target;
      const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
      if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        searchEl.focus();
        searchEl.select();
      } else if (e.key === "Escape" && t === searchEl && searchEl.value) {
        searchEl.value = "";
        applyFilters();
      }
    });
    // on a real pointer device (desktop), start with the cursor in search
    if (window.matchMedia && window.matchMedia("(min-width: 720px) and (hover: hover)").matches) {
      try { searchEl.focus({ preventScroll: true }); } catch (e) { searchEl.focus(); }
    }
  }

  if (clearBtn) {
    clearBtn.addEventListener("click", function () {
      if (searchEl) searchEl.value = "";
      activeTag = "";
      activeCategory = "";
      const sortEl = document.getElementById("toolsSort");
      if (sortEl) sortEl.value = "name";
      renderTagChips();
      renderCategoryChips();
      applyFilters();
      if (searchEl) searchEl.focus();
    });
  }

  const sortEl = document.getElementById("toolsSort");
  if (sortEl) {
    sortEl.addEventListener("change", function () {
      applyFilters();
    });
  }
}

async function loadRegistryAndRender() {
  const errorEl = document.getElementById("toolsError");
  const grid = document.getElementById("toolsGrid");

  if (!grid) return;

  try {
    const modeAttr = document.body && document.body.getAttribute("data-gallery-mode");
    galleryMode = modeAttr === "home" ? "home" : "all";
    homeFeatured = null;

    const res = await fetch(new URL("tools-registry.json", location.href).toString(), { cache: "no-store" });
    if (!res.ok) throw new Error("Failed to load registry (" + res.status + ")");
    const tools = await res.json();

    if (!Array.isArray(tools)) {
      throw new Error("tools-registry.json must export an array of tools");
    }

    // registry is maintained newest-first, so the first toy with a path is the newest
    newestTool = tools.find(function (t) { return t && t.path; }) || null;
    allTools = tools.slice().sort(function (a, b) {
      return String(a.name || "").localeCompare(String(b.name || ""));
    });
    knownTags = collectTagsFromTools(allTools);
    knownCategories = collectCategoriesFromTools(allTools);

    const urlState = readFiltersFromURL();
    const searchEl = document.getElementById("toolsSearch");
    if (galleryMode === "home") {
      if (searchEl) searchEl.value = "";
      activeTag = "";
      activeCategory = "";
    } else {
      if (searchEl) searchEl.value = urlState.q;
      activeTag = urlState.tag;
      activeCategory = urlState.cat;
      const sortEl = document.getElementById("toolsSort");
      if (sortEl) {
        sortEl.value = urlState.sort === "category" ? "category" : "name";
      }
    }
    validateActiveTag();
    validateActiveCategory();

    renderTagChips();
    renderCategoryChips();
    wireSearchAndFilters();
    wireRandomButton();
    renderHomeHero();
    applyFilters();
  } catch (err) {
    if (errorEl) {
      errorEl.hidden = false;
      errorEl.textContent = err && err.message ? err.message : "Could not load tools registry";
    }
  }
}

document.addEventListener("DOMContentLoaded", function () {
  loadRegistryAndRender();
});
