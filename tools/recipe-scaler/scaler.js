/* Recipe Scaler: read a pasted recipe, scale it, and write every amount back
 * the way a cook would. Pure functions with no DOM, so the same file runs in
 * the page (window.RecipeScaler) and in node tests (module.exports).
 *
 * How it works, in one breath: each line is classified (title, yield, header,
 * ingredient, method). An ingredient line records the exact character spans of
 * its amounts, so rendering is "the original line with those spans replaced".
 * Nothing outside a span is ever touched, and at x1 "as written" every span is
 * replaced by its own original text, so the recipe comes back byte for byte. */
(function (root) {
  "use strict";

  var TSP_ML = 4.92892159375;
  var CUP_ML = TSP_ML * 48;
  var OZ_G = 28.349523125;
  var LB_G = 453.59237;

  /* ------------------------------------------------------------ numbers */

  var FR = "½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞";
  var UNI = {
    "½": 1 / 2, "⅓": 1 / 3, "⅔": 2 / 3, "¼": 1 / 4, "¾": 3 / 4,
    "⅕": 1 / 5, "⅖": 2 / 5, "⅗": 3 / 5, "⅘": 4 / 5, "⅙": 1 / 6,
    "⅚": 5 / 6, "⅛": 1 / 8, "⅜": 3 / 8, "⅝": 5 / 8, "⅞": 7 / 8
  };
  var UNI_OUT = {
    "1/2": "½", "1/3": "⅓", "2/3": "⅔", "1/4": "¼", "3/4": "¾",
    "1/8": "⅛", "3/8": "⅜", "5/8": "⅝", "7/8": "⅞"
  };

  var NUM_SRC = "(?:\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?" +
    "|\\d+ ?[" + FR + "]" +
    "|\\d+(?: +|-)\\d+ *[/⁄] *\\d+" +
    "|\\d+ *[/⁄] *\\d+" +
    "|\\d*\\.\\d+" +
    "|\\d+,\\d{1,2}(?![\\d,])" +
    "|\\d+" +
    "|[" + FR + "])";
  var RE_NUM = new RegExp("^" + NUM_SRC);
  var RE_RANGE = new RegExp("^( *(?:-|–|—|to|or) *)(" + NUM_SRC + ")", "i");

  function numValue(t) {
    t = String(t).trim().replace(/⁄/g, "/");
    var m;
    if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) return parseFloat(t.replace(/,/g, ""));
    if ((m = t.match(new RegExp("^(\\d+) ?([" + FR + "])$")))) return +m[1] + UNI[m[2]];
    if ((m = t.match(/^(\d+)(?: +|-)(\d+) *\/ *(\d+)$/))) return +m[3] ? +m[1] + m[2] / m[3] : NaN;
    if ((m = t.match(/^(\d+) *\/ *(\d+)$/))) return +m[2] ? m[1] / m[2] : NaN;
    if ((m = t.match(/^(\d+),(\d{1,2})$/))) return parseFloat(m[1] + "." + m[2]);
    if (UNI[t] != null) return UNI[t];
    return parseFloat(t);
  }

  var WORDS = {
    a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
    eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12
  };

  // A quantity at the very start of s: a number, a range, or number words.
  function readQty(s) {
    var m = s.match(RE_NUM), v, len, text;
    if (m) {
      text = m[0];
      // "1,5" is a decimal only when a metric unit follows; otherwise it is "1"
      if (/^\d+,\d{1,2}$/.test(text)) {
        var after = s.slice(text.length).replace(/^ +/, "");
        var u = matchUnit(after);
        if (!u || !UNITS[u.key] || !UNITS[u.key].metric) text = text.split(",")[0];
      }
      v = numValue(text);
      if (!isFinite(v)) return null;
      len = text.length;
      var q = { lo: v, hi: null, sep: "", len: len, word: false };
      var r = s.slice(len).match(RE_RANGE);
      if (r) {
        var hv = numValue(r[2]);
        // "or" only makes a range between two plain numbers ("2 or 3")
        if (isFinite(hv) && hv > v) { q.hi = hv; q.sep = r[1]; q.len = len + r[0].length; }
      }
      var dz = s.slice(q.len).match(/^ +dozen\b/i);
      if (dz) { q.lo *= 12; if (q.hi) q.hi *= 12; q.len += dz[0].length; q.dozen = true; }
      q.text = s.slice(0, q.len);
      return q;
    }
    return readWordQty(s);
  }

  function readWordQty(s) {
    var m, v, len, article = false;
    if ((m = s.match(/^half +(?:an? +)?(?=\S)/i))) { v = 0.5; len = m[0].length; m = null; len = len; }
    else if ((m = s.match(/^(a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)(?= )/i))) {
      v = WORDS[m[1].toLowerCase()]; len = m[0].length;
      article = /^an?$/i.test(m[1]);
      var x = s.slice(len).match(/^ +and +(?:a +|one[- ])?half\b/i);
      if (x) { v += 0.5; len += x[0].length; article = false; }
      else if (v === 1 && (x = s.slice(len).match(/^ +half\b/i))) { v = 0.5; len += x[0].length; article = false; }
    } else return null;
    var q = { lo: v, hi: null, sep: "", len: len, word: true, article: article };
    var dz = s.slice(len).match(/^ +dozen\b/i);
    if (dz) { q.lo *= 12; q.len += dz[0].length; q.dozen = true; q.article = false; }
    q.text = s.slice(0, q.len);
    return q;
  }

  /* -------------------------------------------------------------- units */

  var UNITS = {
    tsp: { dim: "vol", ml: TSP_ML, s: "tsp", l1: "teaspoon", l2: "teaspoons" },
    tbsp: { dim: "vol", ml: TSP_ML * 3, s: "tbsp", l1: "tablespoon", l2: "tablespoons" },
    cup: { dim: "vol", ml: CUP_ML, s: "cup", s2: "cups", l1: "cup", l2: "cups" },
    floz: { dim: "vol", ml: TSP_ML * 6, s: "fl oz", l1: "fluid ounce", l2: "fluid ounces" },
    pint: { dim: "vol", ml: CUP_ML * 2, s: "pint", s2: "pints", l1: "pint", l2: "pints" },
    quart: { dim: "vol", ml: CUP_ML * 4, s: "quart", s2: "quarts", l1: "quart", l2: "quarts" },
    gallon: { dim: "vol", ml: CUP_ML * 16, s: "gallon", s2: "gallons", l1: "gallon", l2: "gallons" },
    ml: { dim: "vol", ml: 1, s: "ml", l1: "milliliter", l2: "milliliters", metric: true },
    cl: { dim: "vol", ml: 10, s: "cl", l1: "centiliter", l2: "centiliters", metric: true },
    dl: { dim: "vol", ml: 100, s: "dl", l1: "deciliter", l2: "deciliters", metric: true },
    l: { dim: "vol", ml: 1000, s: "L", l1: "liter", l2: "liters", metric: true },
    g: { dim: "wt", g: 1, s: "g", l1: "gram", l2: "grams", metric: true },
    kg: { dim: "wt", g: 1000, s: "kg", l1: "kilogram", l2: "kilograms", metric: true },
    oz: { dim: "wt", g: OZ_G, s: "oz", l1: "ounce", l2: "ounces" },
    lb: { dim: "wt", g: LB_G, s: "lb", l1: "pound", l2: "pounds" },
    stick: { dim: "stick", s: "stick", s2: "sticks", l1: "stick", l2: "sticks" },
    pinch: { dim: "pinch" }, dash: { dim: "pinch" }, smidgen: { dim: "pinch" }
  };
  var PACK = { can: 1, package: 1, packet: 1, jar: 1, bottle: 1, bag: 1, box: 1, container: 1 };

  // Order matters: longer spellings first, and the case-sensitive T/t pair
  // after every longer tablespoon/teaspoon spelling.
  var UNIT_RE = [
    ["floz", /^(?:fluid +ounces?|fl\.? *ounces?|fl\.? *oz\.?)/i],
    ["tsp", /^(?:teaspoons?|teaspoonfuls?|tsps?\.?|tspns?\.?)/i],
    ["tbsp", /^(?:tablespoons?|tablespoonfuls?|tbsps?\.?|tblsps?\.?|tbls?\.?|tbs\.?)/i],
    ["tbsp", /^(?:Tb|T)\.?/],
    ["tsp", /^t\.?/],
    ["cup", /^(?:cups?|c\.?)/i],
    ["pint", /^(?:pints?|pts?\.?)/i],
    ["quart", /^(?:quarts?|qts?\.?)/i],
    ["gallon", /^(?:gallons?|gal\.?)/i],
    ["ml", /^(?:millilit(?:er|re)s?|mls?\.?)/i],
    ["cl", /^(?:centilit(?:er|re)s?|cl\.?)/i],
    ["dl", /^(?:decilit(?:er|re)s?|dl\.?)/i],
    ["l", /^(?:lit(?:er|re)s?|ltrs?\.?|l\.?)/i],
    ["kg", /^(?:kilogram(?:me)?s?|kilos?|kgs?\.?)/i],
    ["g", /^(?:gram(?:me)?s?|grs?\.?|g\.?)/i],
    ["oz", /^(?:ounces?|ozs?\.?)/i],
    ["lb", /^(?:pounds?|lbs?\.?)/i],
    ["pinch", /^pinch(?:es)?/i],
    ["dash", /^dash(?:es)?/i],
    ["smidgen", /^(?:smidg(?:en|eon)s?|smidge)/i],
    ["stick", /^sticks?/i],
    ["clove", /^cloves?/i],
    ["can", /^(?:cans?|tins?)/i],
    ["package", /^(?:packages?|pkgs?\.?|packs?)/i],
    ["packet", /^(?:packets?|envelopes?|sachets?)/i],
    ["jar", /^jars?/i],
    ["bottle", /^bottles?/i],
    ["bag", /^bags?/i],
    ["box", /^box(?:es)?/i],
    ["container", /^(?:containers?|cartons?|tubs?)/i],
    ["slice", /^slices?/i],
    ["piece", /^pieces?/i],
    ["head", /^heads?/i],
    ["bunch", /^bunch(?:es)?/i],
    ["sprig", /^sprigs?/i],
    ["stalk", /^(?:stalks?|ribs?)/i],
    ["sheet", /^sheets?/i],
    ["leaf", /^(?:leaf|leaves)/i],
    ["handful", /^handfuls?/i],
    ["drop", /^drops?/i],
    ["cube", /^cubes?/i],
    ["inch", /^(?:inch(?:es)?|in\.)/i]
  ];

  function matchUnit(s, measureOnly) {
    for (var i = 0; i < UNIT_RE.length; i++) {
      var key = UNIT_RE[i][0];
      if (measureOnly && !(UNITS[key] && (UNITS[key].dim === "vol" || UNITS[key].dim === "wt" || UNITS[key].dim === "stick"))) continue;
      var m = s.match(UNIT_RE[i][1]);
      if (!m) continue;
      var next = s.charAt(m[0].length);
      if (next && /[A-Za-z0-9À-ɏ]/.test(next)) continue;
      return { key: key, tok: m[0], len: m[0].length };
    }
    return null;
  }
  function dimOf(key) {
    if (!key) return "count";
    var u = UNITS[key];
    return u ? u.dim : "count";
  }

  // A measure inside a parenthesis or after a slash: "14 oz", "250g",
  // "8-ounce", "about 2 lb", "3 to 4 pounds", "8 oz each".
  function readMeasure(s, allowHyphen) {
    var lead = s.match(/^ *(?:about|approx\.?|approximately|roughly|around|scant|generous|total of)? */i)[0];
    var rest = s.slice(lead.length);
    var q = readQty(rest);
    if (!q || q.word) return null;
    var gap = rest.slice(q.len).match(allowHyphen ? /^ *-? */ : /^ */)[0];
    var u = matchUnit(rest.slice(q.len + gap.length), true);
    if (!u) return null;
    return {
      lead: lead, q: q, gap: gap, unit: u,
      len: lead.length + q.len + gap.length + u.len,
      numStart: lead.length
    };
  }

  /* ------------------------------------------------------- ingredients */

  // Grams per US cup, compiled for this tool: each figure is our own pick
  // after comparing a baker's weight chart (spoon-and-level) with the USDA
  // nutrient database's household measures, rounded where they disagree.
  // kind: dry | fat | sticky | thick (weighed in metric) or liquid (ml).
  var DENSITY = [
    ["almond flour", 105, "dry", /\balmond (?:flour|meal)\b/],
    ["bread flour", 130, "dry", /\bbread flour\b/],
    ["cake flour", 120, "dry", /\b(?:cake|pastry) flour\b/],
    ["whole wheat flour", 115, "dry", /\bwhole[- ]?(?:wheat|grain) flour\b|\bwholemeal flour\b/],
    ["self-rising flour", 120, "dry", /\bself[- ]ris(?:ing|ed) flour\b|\bself[- ]raising flour\b/],
    ["all-purpose flour", 125, "dry", /\bflour\b/, /\b(?:rice|coconut|chickpea|oat|rye|spelt|buckwheat|tapioca|potato|semolina|corn|cassava|teff|sorghum|millet|00) flour\b|tortilla/],
    ["cornstarch", 120, "dry", /\bcorn ?starch\b|\bcornflour\b/],
    ["cornmeal", 140, "dry", /\bcorn ?meal\b|\bpolenta\b/],
    ["cocoa powder", 85, "dry", /\bcocoa\b/, /\bcocoa butter|cocoa nibs\b/],
    ["powdered sugar", 115, "dry", /\b(?:powdered|confectioners'?|icing) sugar\b/],
    ["brown sugar", 215, "dry", /\b(?:light |dark )?(?:brown|muscovado) sugar\b/],
    ["granulated sugar", 200, "dry", /\bsugar\b/, /\b(?:coconut|maple|demerara|turbinado|raw|vanilla) sugar\b|sugar snap/],
    ["steel-cut oats", 165, "dry", /\bsteel[- ]cut oats\b/],
    ["rolled oats", 90, "dry", /\boats\b/, /oat milk/],
    ["rice", 190, "dry", /\b(?:white |long[- ]grain |jasmine |basmati |arborio |short[- ]grain )*rice\b/, /\brice (?:vinegar|wine|milk|flour|noodles?|paper|cakes?|cereal)\b|\bcooked\b|\bbrown rice\b|\bwild rice\b/],
    ["quinoa", 175, "dry", /\bquinoa\b/, /\bcooked\b/],
    ["dried lentils", 195, "dry", /\blentils\b/, /\bcooked\b|\bcanned\b/],
    ["chocolate chips", 170, "dry", /\bchocolate (?:chips|chunks|morsels)\b|\b(?:chocolate|butterscotch|peanut butter|white chocolate) chips\b/],
    ["chopped walnuts", 115, "dry", /\bwalnuts?\b/],
    ["chopped pecans", 110, "dry", /\bpecans?\b/],
    ["sliced almonds", 90, "dry", /\b(?:sliced|slivered|flaked) almonds\b/],
    ["whole almonds", 143, "dry", /\balmonds\b/],
    ["cashews", 130, "dry", /\bcashews\b/],
    ["peanuts", 145, "dry", /\bpeanuts\b/],
    ["pistachios", 120, "dry", /\bpistachios\b/],
    ["raisins", 145, "dry", /\braisins\b/],
    ["dried cranberries", 120, "dry", /\bdried cranberries\b/],
    ["shredded coconut", 90, "dry", /\b(?:shredded|flaked|desiccated|sweetened) coconut\b|\bcoconut flakes\b/],
    ["sesame seeds", 145, "dry", /\bsesame seeds\b/],
    ["chia seeds", 155, "dry", /\bchia\b/],
    ["ground flaxseed", 105, "dry", /\bflax ?(?:seed)?(?: meal)?\b|\bflaxseed\b/],
    ["graham cracker crumbs", 90, "dry", /\bgraham cracker crumbs?\b/],
    ["panko", 55, "dry", /\bpanko\b/],
    ["dry breadcrumbs", 110, "dry", /\bbread ?crumbs\b/, /\bfresh\b/],
    ["mini marshmallows", 45, "dry", /\bmarshmallows\b/],
    ["grated parmesan", 100, "dry", /\bparmesan\b|\bparmigiano\b|\bpecorino\b/],
    ["shredded cheddar", 113, "dry", /\bcheddar\b|\bmonterey jack\b|\bcolby\b|\bgruy[eè]re\b|\bswiss cheese\b|\bshredded cheese\b/],
    ["shredded mozzarella", 113, "dry", /\bmozzarella\b/],
    ["blueberries", 150, "dry", /\bblueberries\b/],
    ["table salt", 290, "dry", /\bsalt\b/, /\b(?:kosher|flaky|flake|sea|coarse|seasoned|garlic|celery|onion) salt\b|\bsalted\b/],
    ["honey", 340, "sticky", /\bhoney\b/],
    ["molasses", 340, "sticky", /\bmolasses\b|\btreacle\b/],
    ["corn syrup", 320, "sticky", /\b(?:corn|golden) syrup\b/],
    ["peanut butter", 265, "sticky", /\b(?:peanut|almond|cashew|nut|seed) butter\b/],
    ["shortening", 195, "fat", /\bshortening\b/],
    ["butter", 227, "fat", /\bbutter\b/, /\bbutter ?beans?\b|\bapple butter\b|\bcocoa butter\b/],
    ["sour cream", 230, "thick", /\bsour cream\b/],
    ["yogurt", 235, "thick", /\byogh?urt\b/],
    ["cream cheese", 230, "thick", /\bcream cheese\b/],
    ["ricotta", 235, "thick", /\bricotta\b/],
    ["cottage cheese", 225, "thick", /\bcottage cheese\b/],
    ["mascarpone", 230, "thick", /\bmascarpone\b/],
    ["mashed banana", 225, "thick", /\bbananas?\b/],
    ["pumpkin puree", 235, "thick", /\bpumpkin (?:pur[eé]e|puree)\b|\bcanned pumpkin\b/],
    ["applesauce", 250, "thick", /\bapple ?sauce\b/],
    ["mayonnaise", 225, "thick", /\bmayonnaise\b|\bmayo\b/],
    ["ketchup", 240, "thick", /\bketchup\b/]
  ].map(function (r) { return { label: r[0], gpc: r[1], kind: r[2], re: r[3], not: r[4] || null }; });

  var LIQUID_RE = /\b(?:water|milk|buttermilk|cream|half[- ]and[- ]half|oils?|vinegar|juice|broth|stock|wine|beer|coffee|espresso|tea|vanilla extract|vanilla essence|extract|soy sauce|tamari|worcestershire|fish sauce|hot sauce|syrup|liqueur|rum|bourbon|whiskey|vodka|brandy|sherry|cider|kefir|soda|seltzer|dressing|marinade)\b/;
  var NOT_LIQUID_RE = /\bcream cheese\b|\bsour cream\b|\bice cream\b|\bcream of tartar\b|\bmilk chocolate\b|\bmilk powder\b|\bpowdered milk\b|\bin oil\b|\boil[- ]packed\b|\bstock cubes?\b|\bbouillon\b|\btea ?bags?\b/;
  var KOSHER = { label: "kosher salt", gpc: null, kind: "kosher" };
  // Whether the author spells units out ("tablespoons") or abbreviates ("tbsp")
  var LONG_RE = /^(?:teaspoon|tablespoon|ounce|pound|gram|gramme|kilogram|kilo|milliliter|millilitre|liter|litre|fluid ounce)s?$/i;
  var SHORT_RE = /^(?:tsps?|tbsps?|tbls?|tbs|T|t|Tb|oz|ozs|lbs?|g|gr|kgs?|mls?|l|ltr|fl\.? ?oz)\.?$/i;

  function ingredientName(rest) {
    return String(rest || "").toLowerCase()
      .replace(/\([^)]*\)/g, " ")
      .split(/[,;]| for | to /)[0]
      .replace(/\s+/g, " ").trim();
  }
  function lookup(rest) {
    var n = ingredientName(rest);
    if (!n) return null;
    if (/\bkosher salt\b/.test(n)) return KOSHER;
    for (var i = 0; i < DENSITY.length; i++) {
      var d = DENSITY[i];
      if (d.re.test(n) && !(d.not && d.not.test(n))) return d;
    }
    if (LIQUID_RE.test(n) && !NOT_LIQUID_RE.test(n)) return { label: n, gpc: null, kind: "liquid" };
    return null;
  }
  function eggKind(rest) {
    var n = ingredientName(rest);
    if (/\begg ?plants?\b/.test(n)) return null;
    if (/\b(?:egg )?yolks?\b/.test(n)) return "yolk";
    if (/\begg ?whites?\b/.test(n)) return "white";
    if (/\beggs?\b/.test(n)) return "egg";
    return null;
  }

  /* ---------------------------------------------------------- inflection */

  var IRREG = { leaf: "leaves", loaf: "loaves", half: "halves", knife: "knives", potato: "potatoes", tomato: "tomatoes", mango: "mangoes", box: "boxes", bunch: "bunches", pinch: "pinches", dash: "dashes", inch: "inches", radish: "radishes", peach: "peaches" };
  var IRREG_BACK = {};
  Object.keys(IRREG).forEach(function (k) { IRREG_BACK[IRREG[k]] = k; });
  var SAME = { fish: 1, sheep: 1, shrimp: 1, deer: 1, dozen: 1, squid: 1, salmon: 1, tuna: 1, cod: 1, trout: 1, moose: 1 };
  var MASS = { garlic: 1, ginger: 1, salt: 1, pepper: 0, rice: 1, flour: 1, sugar: 1, butter: 1, water: 1, milk: 1, cream: 1, cheese: 1, bread: 1, celery: 1, parsley: 1, cilantro: 1, basil: 1, spinach: 1, kale: 1, lettuce: 1, broccoli: 1, cauliflower: 1, corn: 1, bacon: 1, meat: 1, beef: 1, pork: 1, tofu: 1, oil: 1, zest: 1, juice: 1, yeast: 1, chocolate: 1, dough: 1, ice: 1, thyme: 1, rosemary: 1, oregano: 1, dill: 1, mint: 1, sage: 1, chives: 1, paprika: 1, cinnamon: 1, nutmeg: 1, cumin: 1, vanilla: 1, honey: 1, syrup: 1, stock: 1, broth: 1, wine: 1 };
  var ABBR = { lbs: "lb", lb: "lb", pkgs: "pkg", pkg: "pkg", qts: "qt", qt: "qt", pts: "pt", pt: "pt", tsps: "tsp", tsp: "tsp", tbsps: "tbsp", tbsp: "tbsp", tbs: "tbs", tbls: "tbl", tbl: "tbl", ozs: "oz", oz: "oz", grs: "gr", gr: "gr", kgs: "kg", kg: "kg", mls: "ml", ml: "ml", g: "g", l: "l", c: "c", t: "t", gal: "gal", pcs: "pc", pc: "pc", ltrs: "ltr", ltr: "ltr", tspn: "tspn", tspns: "tspn", tblsp: "tblsp", tblsps: "tblsp", cl: "cl", dl: "dl", tb: "tb" };

  function matchCase(src, word) {
    if (!src) return word;
    if (src.length > 1 && src === src.toUpperCase() && /[A-Z]/.test(src)) return word.toUpperCase();
    if (src.charAt(0) !== src.charAt(0).toLowerCase()) return word.charAt(0).toUpperCase() + word.slice(1);
    return word;
  }
  function pluralWord(w) {
    var low = w.toLowerCase();
    if (SAME[low] || MASS[low]) return w;
    if (IRREG[low]) return matchCase(w, IRREG[low]);
    if (IRREG_BACK[low]) return w;
    if (/[^aeiou]y$/.test(low)) return w.slice(0, -1) + matchCase(w.slice(-1), "ies");
    if (/(?:s|x|z|ch|sh)$/.test(low)) return /(?:ss|x|z|ch|sh)$/.test(low) ? w + "es" : w;
    return w + (w === w.toUpperCase() && w.length > 1 ? "S" : "s");
  }
  function singularWord(w) {
    var low = w.toLowerCase();
    if (SAME[low] || MASS[low]) return w;
    if (IRREG_BACK[low]) return matchCase(w, IRREG_BACK[low]);
    if (IRREG[low]) return w;
    if (/[^aeiou]ies$/.test(low)) return w.slice(0, -3) + "y";
    if (/(?:sses|ches|shes|xes|zes)$/.test(low)) return w.slice(0, -2);
    if (/s$/.test(low) && !/(?:ss|us|is)$/.test(low)) return w.slice(0, -1);
    return w;
  }
  // A unit token as written ("cup", "Tbsp.", "lbs", "teaspoons") inflected
  // for a new amount, keeping the author's spelling and case.
  function inflectTok(tok, plural) {
    var dot = /\.$/.test(tok) ? "." : "";
    var t = tok.replace(/\.$/, "");
    var low = t.toLowerCase().replace(/\s+/g, " ");
    if (/^fl\.? ?oz$/.test(low)) return tok;
    if (ABBR[low] !== undefined) {
      if (!plural && /s$/.test(low) && ABBR[low] !== low) return matchCase(t, ABBR[low]) + dot;
      return tok;
    }
    if (/^(?:fluid ounces?|fl\.? ?ounces?)$/.test(low)) return plural ? t.replace(/ounce$/i, function (x) { return x + "s"; }) : t.replace(/ounces$/i, function (x) { return x.slice(0, -1); });
    if (/^in$/.test(low)) return tok;
    return (plural ? pluralWord(t) : singularWord(t)) + dot;
  }

  /* --------------------------------------------------------- formatting */

  function fracList(arr) { return arr.map(function (p) { return { n: p[0], d: p[1], v: p[0] / p[1] }; }); }
  var FR_CUP = fracList([[1, 4], [1, 3], [1, 2], [2, 3], [3, 4]]);
  var FR_TSP = fracList([[1, 8], [1, 4], [1, 2], [3, 4]]);
  var FR_HALF = fracList([[1, 2]]);
  var FR_QUARTER = fracList([[1, 4], [1, 2], [3, 4]]);
  var FR_COUNT = fracList([[1, 4], [1, 3], [1, 2], [2, 3], [3, 4]]);

  // Nearest whole-plus-fraction from an allowed set.
  function nearest(v, set) {
    var w = Math.floor(v + 1e-9), r = v - w, best = { w: w, n: 0, d: 1, err: r };
    if (1 - r < best.err) best = { w: w + 1, n: 0, d: 1, err: 1 - r };
    for (var i = 0; i < set.length; i++) {
      var e = Math.abs(r - set[i].v);
      if (e < best.err - 1e-9) best = { w: w, n: set[i].n, d: set[i].d, err: e };
    }
    best.val = best.w + best.n / best.d;
    return best;
  }
  function fracText(f, style) {
    if (!f.n) return String(f.w);
    var key = f.n + "/" + f.d;
    var uni = style && style.uni && UNI_OUT[key];
    var fr = uni ? UNI_OUT[key] : key;
    if (!f.w) return fr;
    return f.w + (uni ? (style.uniSpace ? " " : "") : " ") + fr;
  }
  function trimNum(x, dp) {
    var s = x.toFixed(dp);
    if (s.indexOf(".") >= 0) s = s.replace(/0+$/, "").replace(/\.$/, "");
    return s;
  }
  function roundMetric(x) {
    if (x >= 50) return Math.round(x / 5) * 5;
    if (x >= 10) return Math.round(x);
    if (x >= 1) return Math.round(x * 2) / 2;
    return Math.max(0.1, Math.round(x * 10) / 10);
  }

  function unitWord(key, val, style) {
    var u = UNITS[key], plural = val > 1;
    if (style && style.long) return plural ? u.l2 : u.l1;
    if (u.s2 && plural) return u.s2;
    return u.s;
  }

  // US volume, in teaspoons, as a cook would measure it. Every form is a
  // candidate; the winner balances accuracy against an extra measuring step.
  function usVolParts(tsp) {
    if (tsp < 0.094) return { pinch: true, val: tsp, parts: [] };   // a pinch is about 1/16 tsp
    var cands = [];
    function add(parts, cx) {
      var v = 0;
      parts.forEach(function (p) { v += p.f.val * (p.u === "cup" ? 48 : p.u === "tbsp" ? 3 : 1); });
      if (v <= 0) return;
      cands.push({ parts: parts, v: v, score: Math.abs(v - tsp) / tsp + cx });
    }
    var i, w, r;
    if (tsp < 3.6) {
      var t = nearest(tsp, FR_TSP);
      if (t.val > 0 && t.val < 3) add([{ f: t, u: "tsp" }], 0);
      if (t.val === 0) add([{ f: { w: 0, n: 1, d: 8, val: 0.125 }, u: "tsp" }], 0);
    }
    if (tsp >= 2 && tsp < 30) {
      for (w = 1; w <= 8; w++) {
        add([{ f: { w: w, n: 0, d: 1, val: w }, u: "tbsp" }], w >= 4 ? 0.02 : 0);
        if (w < 4) add([{ f: { w: w, n: 1, d: 2, val: w + 0.5 }, u: "tbsp" }], 0.005);
        if (w < 4) for (r = 1; r <= 2; r++) add([{ f: { w: w, n: 0, d: 1, val: w }, u: "tbsp" }, { f: { w: r, n: 0, d: 1, val: r }, u: "tsp" }], 0.06);
      }
    }
    if (tsp >= 9) {
      var c = tsp / 48, base = Math.floor(c);
      for (w = Math.max(0, base - 1); w <= base + 1; w++) {
        var fr = [{ n: 0, d: 1, v: 0 }].concat(FR_CUP);
        for (i = 0; i < fr.length; i++) {
          var f = { w: w, n: fr[i].n, d: fr[i].d, val: w + fr[i].v };
          if (f.val <= 0) continue;
          add([{ f: f, u: "cup" }], fr[i].d === 3 ? 0.004 : 0);
          if (c < 4) for (r = 1; r <= 3; r++) add([{ f: f, u: "cup" }, { f: { w: r, n: 0, d: 1, val: r }, u: "tbsp" }], 0.06);
        }
      }
    }
    cands.sort(function (a, b) { return a.score - b.score; });
    var best = cands[0];
    var rel = (tsp - best.v) / tsp;
    return { parts: best.parts, val: best.v, adj: best.parts.length === 1 && Math.abs(rel) > 0.1 ? (rel > 0 ? "heaping" : "scant") : null };
  }

  function partsText(res, style, keepTok) {
    if (res.pinch) return "a pinch";
    var long = style && style.long;
    var bits = res.parts.map(function (p) {
      var val = p.f.val;
      var word = keepTok && keepTok.key === p.u ? inflectTok(keepTok.tok, val > 1) : unitWord(p.u, val, style);
      return fracText(p.f, style) + " " + word;
    });
    var s = bits.join(long ? " plus " : " + ");
    if (res.adj) s = "a " + res.adj + " " + s;
    return s;
  }

  // Amount text for a base quantity in the line's dimension, under a mode.
  // Returns { text, unit, val, vol (stays a volume for lack of a weight),
  // pinch, approx }.
  function formatMeasure(base, dim, origKey, origTok, ingr, mode, style) {
    var keep = origKey ? { key: origKey, tok: origTok } : null;
    var metricOrig = origKey && UNITS[origKey] && UNITS[origKey].metric;
    var kind = ingr ? ingr.kind : null;
    var weighable = ingr && ingr.gpc && kind !== "liquid";

    if (dim === "stick") {
      if (mode === "metric") return metricWeight(base / CUP_ML * 227, null, style);
      var sticks = base / (24 * TSP_ML);
      if (sticks < 0.24) return usVolume(base, null, style);
      var f = nearest(sticks, FR_QUARTER);
      return { text: fracText(f, style) + " " + inflectTok(origTok || "stick", f.val > 1), unit: "stick", val: f.val };
    }
    if (dim === "vol") {
      if (mode === "metric") {
        if (metricOrig) return metricVolume(base, origKey, origTok, style);
        if (weighable && (base >= TSP_ML * 12 * 0.99 || (kind === "fat" && base >= TSP_ML * 3 * 0.99))) {
          return metricWeight(base / CUP_ML * ingr.gpc, null, style);
        }
        if (base < TSP_ML * 12 * 0.99 && (origKey === "tsp" || origKey === "tbsp" || origKey === "cup" || origKey === "floz")) {
          var sp = usVolume(base, origKey === "tsp" || origKey === "tbsp" ? keep : null, style);
          if (sp.unit !== "cup") return sp;
          // metric kitchens measure with spoons, not cups
          var tb = nearest(base / UNITS.tbsp.ml, FR_HALF);
          return { text: fracText(tb, style) + " " + (keep && keep.key === "tbsp" ? inflectTok(keep.tok, tb.val > 1) : unitWord("tbsp", tb.val, style)), unit: "tbsp", val: tb.val };
        }
        var mv = metricVolume(base, null, null, style);
        mv.vol = !(kind === "liquid");
        if (kind === "kosher") mv.kosher = true;
        return mv;
      }
      if (metricOrig && mode === "asis") return metricVolume(base, origKey, origTok, style);
      if (origKey === "floz" && base >= UNITS.floz.ml * 0.99) {
        var fl = nearest(base / UNITS.floz.ml, FR_HALF);
        return { text: fracText(fl, style) + " " + inflectTok(origTok, fl.val > 1), unit: "floz", val: fl.val };
      }
      if ((origKey === "pint" || origKey === "quart" || origKey === "gallon") && base >= CUP_ML * 2) {
        var big = origKey === "gallon" && base >= UNITS.gallon.ml * 0.99 ? "gallon" :
          origKey !== "pint" && base >= UNITS.quart.ml * 0.99 ? "quart" :
          origKey === "pint" && base >= UNITS.pint.ml * 0.99 ? "pint" : null;
        if (big) {
          var bf = nearest(base / UNITS[big].ml, FR_QUARTER);
          var tok = big === origKey ? inflectTok(origTok, bf.val > 1) : unitWord(big, bf.val, style);
          return { text: fracText(bf, style) + " " + tok, unit: big, val: bf.val };
        }
      }
      return usVolume(base, keep, style);
    }
    if (dim === "wt") {
      if (mode === "metric" || (mode === "asis" && metricOrig)) return metricWeight(base, metricOrig ? { key: origKey, tok: origTok } : null, style);
      if (mode === "us" && metricOrig && weighable) {
        var r = usVolume(base / ingr.gpc * CUP_ML, null, style);
        return r;
      }
      return usWeight(base, metricOrig ? null : keep, style);
    }
    return null;
  }

  function usVolume(ml, keep, style) {
    var res = usVolParts(ml / TSP_ML);
    var main = res.parts[0];
    return {
      text: partsText(res, style, keep), pinch: !!res.pinch,
      unit: main ? main.u : "pinch", val: main ? main.f.val : 0, approx: res.adj,
      parts: res.parts.length
    };
  }
  // Over a kilo (or a liter), a cook writes "1 kg" or "1.5 kg", not
  // "1.02 kg": a round quarter within 2.5% wins; otherwise grams up to 2 kg,
  // then kilos to the nearest 50 g.
  function bigOk(x) { var q = Math.round(x / 250) * 250; return Math.abs(q - x) / x <= 0.025 || x >= 2000; }
  function bigVal(x) {
    var q = Math.round(x / 250) * 250;
    if (Math.abs(q - x) / x <= 0.025) return q / 1000;
    return Math.round(x / 50) * 50 / 1000;
  }
  function metricVolume(ml, origKey, origTok, style) {
    var tight = style && style.tight;
    var sp = tight ? "" : " ";
    if (ml >= 999.5 && bigOk(ml)) {
      var lv = bigVal(ml);
      var ltok = origKey === "l" ? inflectTok(origTok, lv > 1) : "L";
      return { text: trimNum(lv, 2) + sp + ltok, unit: "l", val: lv };
    }
    var v = roundMetric(ml);
    var mtok = origKey === "ml" ? inflectTok(origTok, v > 1) : "ml";
    return { text: trimNum(v, 1) + sp + mtok, unit: "ml", val: v };
  }
  function metricWeight(g, keep, style) {
    var tight = style && style.tight;
    var sp = tight ? "" : " ";
    if (g >= 999.5 && bigOk(g)) {
      var kv = bigVal(g);
      var ktok = keep && keep.key === "kg" ? inflectTok(keep.tok, kv > 1) : "kg";
      return { text: trimNum(kv, 2) + sp + ktok, unit: "kg", val: kv };
    }
    var v = roundMetric(g);
    var gtok = keep && keep.key === "g" ? inflectTok(keep.tok, v > 1) : "g";
    return { text: trimNum(v, 1) + sp + gtok, unit: "g", val: v };
  }
  function usWeight(g, keep, style) {
    var oz = g / OZ_G;
    var lbOk = !(keep && keep.key === "oz" && oz < 16 * 0.97);
    if (oz >= 16 * 0.97 && lbOk) {
      var lb = oz / 16, lf = nearest(lb, FR_QUARTER);
      var ltok = keep && keep.key === "lb" ? inflectTok(keep.tok, lf.val > 1) : unitWord("lb", lf.val, style);
      if (Math.abs(lf.val - lb) / lb <= 0.03) return { text: fracText(lf, style) + " " + ltok, unit: "lb", val: lf.val };
      var whole = Math.floor(lb), rest = Math.round((lb - whole) * 16);
      if (rest === 16) { whole += 1; rest = 0; }
      var wtok = keep && keep.key === "lb" ? inflectTok(keep.tok, whole > 1) : unitWord("lb", whole, style);
      return { text: whole + " " + wtok + (rest ? " " + rest + " " + unitWord("oz", rest, style) : ""), unit: "lb", val: whole + rest / 16 };
    }
    var f = nearest(oz, oz < 4 ? FR_QUARTER : oz < 10 ? FR_HALF : []);
    if (f.val === 0) f = { w: 0, n: 1, d: 4, val: 0.25 };
    var otok = keep && keep.key === "oz" ? inflectTok(keep.tok, f.val > 1) : unitWord("oz", f.val, style);
    return { text: fracText(f, style) + " " + otok, unit: "oz", val: f.val };
  }

  function formatCount(v, style) {
    var f = v >= 10 ? nearest(v, []) : v >= 3 ? nearest(v, FR_HALF) : nearest(v, FR_COUNT);
    if (f.val === 0) f = { w: 0, n: 1, d: 4, val: 0.25 };
    return { text: fracText(f, style), val: f.val };
  }

  // Package sizes are labels: they never scale, only convert.
  function formatSize(m, mode, style) {
    var key = m.unit.key, u = UNITS[key];
    var metric = !!u.metric;
    if (mode === "asis" || (mode === "us" && !metric) || (mode === "metric" && metric)) return null;
    if (u.dim === "wt") {
      var g = m.q.lo * u.g;
      if (mode === "metric") return Math.round(g) + " g";
      var oz = g / OZ_G;
      return trimNum(Math.round(oz * 2) / 2, 1) + " oz";
    }
    var ml = m.q.lo * u.ml;
    if (mode === "metric") return Math.round(ml) + " ml";
    return trimNum(Math.round(ml / UNITS.floz.ml * 2) / 2, 1) + " fl oz";
  }

  /* -------------------------------------------------------- temperature */

  var RE_TEMP = /(\d{2,3})( ?(?:°|º|˚) ?(?:([FC])\b|(Fahrenheit|Celsius|Centigrade)\b)?| ?degrees? ?(?:([FC])\b|(Fahrenheit|Celsius|Centigrade)\b)?|([FC])\b)/g;

  function findTemps(text, system) {
    var out = [], m;
    RE_TEMP.lastIndex = 0;
    while ((m = RE_TEMP.exec(text))) {
      var n = +m[1], letter = (m[3] || m[5] || m[7] || (m[4] || m[6] || "").charAt(0) || "").toUpperCase();
      var start = m.index, end = m.index + m[0].length;
      if (start > 0 && /[\d.\/]/.test(text.charAt(start - 1))) continue;
      if (m[7] && n < 100) continue;                   // "2C" is not a temperature
      if (!letter) {
        if (/degrees?/.test(m[2]) && n < 90) continue; // "45 degrees" is an angle
        if (n >= 275) letter = "F";
        else if (n <= 260 && n >= 90) letter = system === "metric" ? "C" : (n < 200 ? "C" : "F");
        else continue;
        if (!/(?:°|º|˚|degree)/.test(m[2])) continue;
      }
      // already paired with the other scale: "350°F (175°C)", "180C/350F"
      var tail = text.slice(end, end + 18);
      if (/^\s*[(\/]\s*\d{2,3}\s*(?:°|º|degrees?)?\s*[FC]\b/i.test(tail)) {
        var mm = tail.match(/^\s*[(\/]\s*\d{2,3}\s*(?:°|º|degrees?)?\s*[FC]\b\)?/i);
        RE_TEMP.lastIndex = end + mm[0].length;
        continue;
      }
      if (start > 0 && /\(\s*$/.test(text.slice(Math.max(0, start - 3), start)) && /\d\s*(?:°|degrees?)?\s*[FC]\b[^(]{0,3}\(\s*$/i.test(text.slice(Math.max(0, start - 18), start))) continue;
      out.push({ s: start, e: end, n: n, unit: letter, text: m[0] });
    }
    return out;
  }
  // Oven heats round to the dial (5 degree C steps, 25 F where that lands
  // within a few degrees); warm-water and candy heats stay exact.
  function convertTemp(n, unit) {
    if (unit === "F") {
      var c = (n - 32) * 5 / 9;
      return { n: c < 120 ? Math.round(c) : Math.round(c / 5) * 5, unit: "C" };
    }
    var f = n * 9 / 5 + 32;
    if (n < 120) return { n: Math.round(f), unit: "F" };
    var r25 = Math.round(f / 25) * 25;
    return { n: Math.abs(r25 - f) <= 8 ? r25 : Math.round(f / 5) * 5, unit: "F" };
  }

  /* ---------------------------------------------------- line structure */

  var RE_PRE = /^(\s*(?:[-*•·▢☐□▪◦‣⁃–]\s*)?)/;
  var RE_QUAL = /^((?:about|approximately|approx\.?|roughly|around|scant|generous|heaping|heaped|rounded|level|a +scant|a +generous|a +heaping) +)(?=[\d½⅓⅔¼¾⅕-⅞])/i;
  var RE_OF = /^((?:the +)?(?:finely +|freshly +)?(?:grated +|squeezed +)?(?:juice|zest|zest +and +juice|juice +and +zest)(?: +and +(?:juice|zest))? +of +)/i;
  var RE_MOD = /^((?:heaping|heaped|scant|level|rounded|generous|good|big|small|large|medium|packed|firmly +packed|lightly +packed|loosely +packed|sifted|level|full) +)/i;
  var RE_NOT_ING = /^ *(?:°|º|degrees?\b|deg\b|%|percent\b|minutes?\b|mins?\b|hours?\b|hrs?\b|seconds?\b|secs?\b|days?\b|weeks?\b|times\b|servings?\b|people\b|persons?\b|portions?\b|calories\b|kcal\b|to +\d|x\s*\d+\s*(?:inch|in\b|cm|"))/i;
  var RE_HEAD_METHOD = /^\s*(?:instructions|directions|method|preparation|steps|how to make(?: it)?|to make|procedure)\b\s*:?\s*$/i;
  var RE_HEAD_ING = /^\s*(?:ingredients|for the .{1,40}|for .{1,30}:|you(?:'ll| will) need|equipment|to serve|for serving|garnish|toppings?|notes?)\s*:?\s*$/i;
  var RE_YIELD = /^(\s*(?:[-*•]\s*)?)(serves|servings?|yields?|makes|portions?|feeds)(\s*:?\s*)((?:about|approximately|approx\.?|around|up to)\s+)?(\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|a)(?:(\s*(?:-|–|—|to|or)\s*)(\d+(?:\.\d+)?))?(\b.*)$/i;
  var RE_YIELD_B = /^(\s*)()()()(\d+)(?:(\s*(?:-|–|to)\s*)(\d+))?(\s+(?:servings?|portions?|people|persons?)\b.*)$/i;

  // Parse one ingredient line. Returns null when the line is not one.
  function parseIngredient(raw) {
    var pre = raw.match(RE_PRE)[1];
    var at = pre.length;
    var s = raw.slice(at);
    var qual = s.match(RE_QUAL);
    if (qual) { at += qual[1].length; s = s.slice(qual[1].length); }
    var of = null;
    if (!qual && (of = s.match(RE_OF))) { at += of[1].length; s = s.slice(of[1].length); }

    var q = readQty(s);
    if (!q) return null;
    if (q.word && raw.length > 70) return null;
    var after = s.slice(q.len);
    if (RE_NOT_ING.test(after)) return null;
    if (/^\s*[-–]?\s*$/.test(after) && !q.word) return null; // a bare number
    if (/^\.\s/.test(after) || /^\)\s/.test(after)) return null;    // "1. Preheat" / "1) Mix"

    var P = {
      kind: "ing", raw: raw, start: at, q: q,
      unit: null, size: null, mod: null, equiv: null, compound: 0,
      head: null, tmeas: [], tcount: [], temps: []
    };
    var p = q.len;        // cursor within s
    var m, gap;

    // "2 x 400g tins" / "1 (14 oz) can" / "1 14-ounce can"
    if ((m = s.slice(p).match(/^ *[x×] */i)) && (gap = readMeasure(s.slice(p + m[0].length), false))) {
      P.size = { form: "x", m: gap, s: p, e: p + m[0].length + gap.len, sep: m[0], text: s.slice(p + m[0].length, p + m[0].length + gap.len) };
      p = P.size.e;
    } else if ((m = s.slice(p).match(/^ *\(/))) {
      var close = s.indexOf(")", p);
      var inner = close > 0 ? s.slice(p + m[0].length, close) : "";
      var meas = inner ? readMeasure(inner, true) : null;
      if (meas && /^\s*(?:each|ea\.?)?\s*$/i.test(inner.slice(meas.len)) && !q.word) {
        P.size = { form: "paren", m: meas, s: p, e: close + 1, inner: inner, innerStart: p + m[0].length, text: inner };
        p = close + 1;
      }
    } else if ((m = s.slice(p).match(/^ +/)) && /^\d/.test(s.slice(p + m[0].length))) {
      var inl = readMeasure(s.slice(p + m[0].length), true);
      if (inl && !inl.lead) {
        var tail = s.slice(p + m[0].length + inl.len);
        var tu = matchUnit(tail.replace(/^\s+/, ""));
        if (/^\s+\S/.test(tail) && (!q.word || (tu && PACK[tu.key]))) {
          P.size = { form: "inline", m: inl, s: p, e: p + m[0].length + inl.len, sp: m[0], text: s.slice(p + m[0].length, p + m[0].length + inl.len) };
          p = P.size.e;
        }
      }
    }

    // a modifier that belongs to the unit: "1 heaping tbsp", "1 packed cup"
    var spA = s.slice(p).match(/^ */)[0];
    var mod = s.slice(p + spA.length).match(RE_MOD);
    var u = null, modLen = 0;
    if (mod) {
      u = matchUnit(s.slice(p + spA.length + mod[1].length));
      if (u) modLen = mod[1].length; else mod = null;
    }
    if (!u) {
      var hy = s.slice(p).match(/^-(?=inch|in\.)/i);
      if (hy) { spA = "-"; }
      u = matchUnit(s.slice(p + spA.length));
      // "t" and "c" alone are units only when an ingredient follows
      if (u && /^[tTcC]\.?$/.test(u.tok) && !/^\s+\S/.test(s.slice(p + spA.length + u.len))) u = null;
    }
    if (u) {
      // a count noun that happens to share a unit's name ("2 slices" is fine,
      // "1 inch" needs a number); stick is butter only when butter is named
      P.unit = { key: u.key, tok: u.tok, s: p + spA.length + modLen, e: p + spA.length + modLen + u.len, gap: spA };
      if (mod) P.mod = { text: mod[1], s: p + spA.length, e: p + spA.length + modLen };
      P.tight = spA === "" && !q.word;
      p = P.unit.e;
    }
    if (q.word && !u && q.article) return null;   // "A little oil" is not "1 little oil"

    // after the unit: a size for packages, an equivalent for measures
    if (P.unit && !P.size && (m = s.slice(p).match(/^ *\(/))) {
      var c2 = s.indexOf(")", p);
      var in2 = c2 > 0 ? s.slice(p + m[0].length, c2) : "";
      var me2 = in2 ? readMeasure(in2, true) : null;
      if (me2 && /^\s*(?:each|ea\.?)?\s*$/i.test(in2.slice(me2.len))) {
        var rec = { m: me2, s: p, e: c2 + 1, innerStart: p + m[0].length, inner: in2, text: in2 };
        if (PACK[P.unit.key] || /each/i.test(in2)) { rec.form = "paren-after"; P.size = rec; }
        else if (dimOf(P.unit.key) === "vol" || dimOf(P.unit.key) === "wt" || dimOf(P.unit.key) === "stick") { rec.form = "paren"; P.equiv = rec; }
        p = c2 + 1;
      }
    } else if (P.unit && (m = s.slice(p).match(/^ *\/ */)) && (gap = readMeasure(s.slice(p + m[0].length), false))) {
      P.equiv = { form: "slash", m: gap, s: p, e: p + m[0].length + gap.len, innerStart: p + m[0].length, sep: m[0] };
      p = P.equiv.e;
    }

    // "1/2 tsp - 1 tsp", "2 cups to 3 cups": a range that repeats its unit
    if (P.unit && !P.equiv && !q.hi && (m = s.slice(p).match(/^ *(?:-|\u2013|\u2014|to) */i))) {
      var r2 = readMeasure(s.slice(p + m[0].length), false);
      if (r2 && !r2.lead && !r2.q.hi && r2.unit.key === P.unit.key && r2.q.lo > q.lo) {
        q.hi = r2.q.lo; q.sep = m[0].trim() === "to" ? " to " : "-";
        p = p + m[0].length + r2.len;
      }
    }
    // "1 cup plus 2 tablespoons", "1 lb 4 oz"
    if (P.unit && !P.equiv && (dimOf(P.unit.key) === "vol" || dimOf(P.unit.key) === "wt")) {
      var cm = s.slice(p).match(/^ *(?:\+|plus|and)? */i);
      var c3 = cm ? readMeasure(s.slice(p + cm[0].length), false) : null;
      if (c3 && !c3.lead && dimOf(c3.unit.key) === dimOf(P.unit.key) && !c3.q.hi) {
        var big = baseOf(1, P.unit.key), small = baseOf(1, c3.unit.key);
        if (small < big && (cm[0].trim() || (P.unit.key === "lb" && c3.unit.key === "oz"))) {
          P.compound = baseOf(c3.q.lo, c3.unit.key);
          P.compoundEnd = p + cm[0].length + c3.len;
          p = P.compoundEnd;
        }
      }
    }

    P.measEnd = p;
    var rest = s.slice(p);
    P.rest = rest;
    P.restStart = at + p;

    // a count with no unit must be followed by something to count
    if (!P.unit && !/^\s*\S/.test(rest)) return null;
    if (!P.unit && q.word && raw.length > 60) return null;
    if (/[.!?]\s+[A-Z]/.test(rest) && rest.length > 60) return null; // a sentence, not an item

    var dim = dimOf(P.unit && P.unit.key);
    P.ingr = lookup(rest);
    if (P.unit && P.unit.key === "stick") {
      if (/\b(?:butter|margarine)\b/i.test(rest) || /\(.*cup|\(.*tbsp|tablespoon/i.test(rest)) { dim = "stick"; P.ingr = P.ingr || DENSITY.filter(function (d) { return d.label === "butter"; })[0]; }
      else dim = "count";
    }
    // "8 oz milk" means fluid ounces
    if (P.unit && P.unit.key === "oz" && P.ingr && P.ingr.kind === "liquid") { P.unit.key = "floz"; dim = "vol"; }
    P.dim = dim;
    P.egg = (dim === "count" && (!P.unit || P.unit.key === "inch" ? !P.unit : false)) ? eggKind(rest) : null;

    // the counted noun, so "1 egg" can become "2 eggs"
    if (dim === "count" && !P.unit) P.head = headNoun(rest, P.restStart);
    // per-item or "about" measures further along: "(about 3 lb)"
    scanRestMeasures(P, rest, P.restStart);
    return P;
  }

  function headNoun(rest, offset) {
    var cut = rest.search(/[,;(]| (?:at|for|in|with|from|to|plus|and|or|cut|about|such|into|halved|peeled|beaten|divided|softened|melted|chopped|minced|diced|sliced|whisked|separated|lightly|room)\b/i);
    var chunk = cut >= 0 ? rest.slice(0, cut) : rest;
    var m = chunk.match(/([A-Za-z][A-Za-z'\-]*[A-Za-z])\s*$/);
    if (!m) return null;
    var w = m[1], low = w.toLowerCase();
    if (low.length < 3 || MASS[low] || /^(?:large|medium|small|whole|fresh|ripe|extra|jumbo)$/.test(low)) return null;
    var s = offset + chunk.length - m[0].length + (m[0].length - m[0].replace(/^\s+/, "").length);
    s = offset + m.index;
    return { s: s, e: s + w.length, word: w };
  }

  var RE_REST_MEAS = /\(((?:about|approx\.?|approximately|roughly|around|total(?: of)?|a total of|or about)\s+)?([^()]*)\)/gi;
  function scanRestMeasures(P, rest, offset) {
    var m;
    RE_REST_MEAS.lastIndex = 0;
    while ((m = RE_REST_MEAS.exec(rest))) {
      var lead = m[1] || "";
      var inner = m[2];
      var me = readMeasure(inner, true);
      if (!me || me.lead) continue;
      var s0 = offset + m.index + 1 + lead.length;
      P.tmeas.push({ m: me, s: s0 + me.numStart, e: s0 + me.len, scale: !!lead });
    }
    var RE_PLUS = /(?:\bplus|\band|\+) +/gi, pm;
    while ((pm = RE_PLUS.exec(rest))) {
      var from = pm.index + pm[0].length, tailR = rest.slice(from);
      var mq = readQty(tailR);
      if (!mq || mq.article || mq.hi) continue;
      if (P.tmeas.some(function (t) { return t.s <= offset + from && t.e > offset + from; })) continue;
      var mu = matchUnit(tailR.slice(mq.len).replace(/^ +/, ""), true);
      if (mu) {
        var mm2 = readMeasure(tailR, true);
        if (mm2) P.tmeas.push({ m: mm2, s: offset + from + mm2.numStart, e: offset + from + mm2.len, scale: true });
        continue;
      }
      if (!/^ +[A-Za-z]/.test(tailR.slice(mq.len))) continue;
      var hn = headNoun(tailR.slice(mq.len), offset + from + mq.len);
      P.tcount.push({ q: mq, s: offset + from, e: offset + from + mq.len, head: hn, egg: eggKind(tailR.slice(mq.len)) });
    }
    P.temps = findTemps(rest, null).map(function (t) { return { s: offset + t.s, e: offset + t.e, n: t.n, unit: t.unit, raw: t }; });
  }

  function baseOf(v, key) {
    var u = UNITS[key];
    if (!u) return v;
    if (u.dim === "vol") return v * u.ml;
    if (u.dim === "wt") return v * u.g;
    if (u.dim === "stick") return v * 24 * TSP_ML;
    return v;
  }

  /* -------------------------------------------------------------- recipe */

  function parseYield(raw) {
    if (/serving size/i.test(raw)) return null;
    var m = raw.match(RE_YIELD) || raw.match(RE_YIELD_B);
    if (!m) return null;
    var n = WORDS[(m[5] || "").toLowerCase()] || parseFloat(m[5]);
    if (!(n > 0)) return null;
    if (m[5].toLowerCase() === "a" && !/^\s*dozen\b/i.test(m[8] || "")) return null;
    var hi = m[7] ? parseFloat(m[7]) : null;
    var verb = (m[2] || "").toLowerCase();
    var restTxt = (m[8] || "");
    var noun = restTxt.replace(/^\s*[:\-]?\s*/, "").replace(/\(.*$/, "").replace(/[.,;].*$/, "").trim();
    if (!verb) { verb = "serves"; noun = ""; }
    var numStart = m[1].length + m[2].length + m[3].length + (m[4] || "").length;
    var numEnd = numStart + m[5].length + (m[6] || "").length + (m[7] || "").length;
    if (/^(?:a|an)$/i.test(m[5])) { // "Makes a dozen"
      n = 12;
      var dz = restTxt.match(/^\s*dozen\b/i);
      numEnd += dz[0].length;
      noun = restTxt.slice(dz[0].length).replace(/^\s*/, "").replace(/\(.*$/, "").replace(/[.,;].*$/, "").trim();
    }
    var dozen = /^dozen\b/i.test(noun);
    var y = {
      raw: raw, n: n, hi: hi, verb: verb, noun: noun, s: numStart, e: numEnd,
      sep: m[6] || "", about: !!m[4], dozen: dozen, wordNum: !/\d/.test(m[5])
    };
    var head = noun && !dozen ? headNoun(raw.slice(numEnd), numEnd) : null;
    y.head = head;
    return y;
  }

  function isTitleCandidate(line) {
    var t = line.trim();
    if (!t || t.length > 80) return false;
    if (/[.:]$/.test(t) && !/\.\.\.$/.test(t)) return false;
    if (RE_HEAD_METHOD.test(t) || RE_HEAD_ING.test(t)) return false;
    if (/^(?:prep|cook|total|active|bake|ready)\s*(?:time)?\s*:/i.test(t)) return false;
    return true;
  }

  function parseRecipe(text) {
    text = String(text == null ? "" : text).replace(/\r\n?/g, "\n");
    var rows = text.split("\n");
    var lines = [], mode = "ing", title = null, yieldInfo = null, seenContent = false;
    var unitCounts = { us: 0, metric: 0 }, uniCount = 0, uniMixed = 0, uniSpaced = 0, longCount = 0, shortCount = 0;

    rows.forEach(function (raw, i) {
      var L = { i: i, raw: raw, kind: "text" };
      var t = raw.trim();
      if (!t) { L.kind = "blank"; lines.push(L); return; }
      if (!yieldInfo) {
        var y = parseYield(raw);
        if (y) { L.kind = "yield"; L.y = y; yieldInfo = { line: i, y: y }; lines.push(L); seenContent = true; return; }
      }
      if (RE_HEAD_METHOD.test(t)) { mode = "method"; L.kind = "header"; L.method = true; lines.push(L); seenContent = true; return; }
      if (RE_HEAD_ING.test(t)) { mode = "ing"; L.kind = "header"; lines.push(L); seenContent = true; return; }
      if (/^\s*(?:step\s*\d+|\d+\s*[.)])\s+\S/i.test(raw)) {
        mode = "method"; L.kind = "method"; lines.push(L); seenContent = true; return;
      }
      if (mode === "ing") {
        var P = parseIngredient(raw);
        if (P) {
          P.i = i;
          lines.push(P);
          seenContent = true;
          if (P.unit && UNITS[P.unit.key] && (UNITS[P.unit.key].dim === "vol" || UNITS[P.unit.key].dim === "wt")) {
            unitCounts[UNITS[P.unit.key].metric ? "metric" : "us"]++;
            if (LONG_RE.test(P.unit.tok)) longCount++;
            else if (SHORT_RE.test(P.unit.tok)) shortCount++;
          }
          if (new RegExp("[" + FR + "]").test(P.q.text)) {
            uniCount++;
            if (new RegExp("\\d ?[" + FR + "]").test(P.q.text)) { uniMixed++; if (new RegExp("\\d [" + FR + "]").test(P.q.text)) uniSpaced++; }
          }
          return;
        }
      }
      if (!seenContent && !title && isTitleCandidate(raw)) {
        L.kind = "title"; title = { line: i, text: t }; lines.push(L); seenContent = true; return;
      }
      if (/:\s*$/.test(t) && t.length <= 50) { L.kind = "header"; lines.push(L); seenContent = true; return; }
      L.kind = mode === "method" || t.length > 90 || /[.!?]\s+\S/.test(t) ? "method" : "text";
      lines.push(L);
      seenContent = true;
    });
    var system = unitCounts.metric > unitCounts.us ? "metric" : "us";
    lines.forEach(function (L) {
      if (L.kind === "method" || L.kind === "text" || L.kind === "header") L.temps = findTemps(L.raw, system);
      if (L.kind === "ing" && L.temps) L.temps = L.temps.filter(function () { return true; });
    });
    var ings = lines.filter(function (L) { return L.kind === "ing"; });
    return {
      text: text, lines: lines, title: title, yield: yieldInfo ? yieldInfo.y : null, yieldLine: yieldInfo ? yieldInfo.line : -1,
      system: system, count: ings.length,
      style: { uni: uniCount > 0, uniSpace: uniMixed > 0 && uniSpaced * 2 >= uniMixed, long: longCount > shortCount }
    };
  }

  /* -------------------------------------------------------------- render */

  function lineStyle(R, P) {
    var long = P.unit && (LONG_RE.test(P.unit.tok) || SHORT_RE.test(P.unit.tok)) ? LONG_RE.test(P.unit.tok) : R.style.long;
    return { uni: R.style.uni, uniSpace: R.style.uniSpace, long: long, tight: !!P.tight };
  }

  function egNote(v, kind, mode, style, plural) {
    var whole = Math.floor(v + 1e-9), part = v - whole;
    if (part < 0.12 || part > 0.88) return null;
    var per = kind === "yolk" ? 1 : kind === "white" ? 2 : 3;       // tablespoons in a large one
    var perG = kind === "yolk" ? 17 : kind === "white" ? 33 : 50;  // grams, out of the shell
    var name = kind === "yolk" ? "yolk" : kind === "white" ? "egg white" : "egg";
    var beaten = kind === "egg" ? "beaten egg" : kind === "yolk" ? "beaten yolk" : "egg white";
    var amt = mode === "metric" ? Math.round(part * perG) + " g " + beaten : partsText(usVolParts(part * per * 3), { uni: style.uni, uniSpace: style.uniSpace }) + " " + beaten;
    if (!whole) return "Beat 1 " + name + " and use " + amt;
    return whole + " " + (whole > 1 ? (kind === "white" ? "egg whites" : name + "s") : name) + " + " + amt;
  }

  // Render one line under a scale factor and a units mode. The result is a
  // list of segments: plain text, figures (amounts to highlight) and notes.
  function renderLine(R, L, f, mode) {
    var segs = [], note = null, flag = false;
    var exact = f === 1 && mode === "asis";
    if (L.kind === "ing") return renderIngredient(R, L, f, mode);
    if (L.kind === "yield") return renderYield(R, L, f, mode);
    if (L.kind === "blank" || L.kind === "title") return { segs: [{ t: "txt", v: L.raw }], kind: L.kind };
    // method, text, header: only temperatures change
    return { segs: withTemps(L.raw, 0, L.raw.length, L.temps || [], mode, exact), kind: L.kind };
  }

  function withTemps(raw, from, to, temps, mode, exact) {
    var segs = [], pos = from;
    temps.forEach(function (t, k) {
      if (t.s < from || t.e > to) return;
      if (t.s > pos) segs.push({ t: "txt", v: raw.slice(pos, t.s) });
      var conv = null;
      if (!exact && ((mode === "metric" && t.unit === "F") || (mode === "us" && t.unit === "C"))) conv = convertTemp(t.n, t.unit);
      segs.push({ t: "fig", v: raw.slice(t.s, t.e), id: "t" + k, temp: true });
      if (conv) {
        segs.push({ t: "txt", v: " (" });
        segs.push({ t: "fig", v: conv.n + "°" + conv.unit, id: "tc" + k, temp: true, conv: true });
        segs.push({ t: "txt", v: ")" });
      }
      pos = t.e;
    });
    if (pos < to) segs.push({ t: "txt", v: raw.slice(pos, to) });
    return segs;
  }

  function renderIngredient(R, P, f, mode) {
    var raw = P.raw, style = lineStyle(R, P), exact = f === 1 && mode === "asis";
    var at = P.start;
    var spans = [];   // {s, e, segs}
    var note = null, flag = false, volOnly = false, kosher = false;
    var dim = P.dim;
    var key = P.unit ? P.unit.key : null;
    var lo = P.q.lo * f, hi = P.q.hi ? P.q.hi * f : null;
    var measS = at, measE = at + P.measEnd;
    var mainText, mainVal;
    var have = null;

    if (exact) {
      var mEnd = P.equiv ? at + P.equiv.s : (P.unit || P.size) ? measE : at + P.q.len;
      spans.push({ s: measS, e: mEnd, segs: [{ t: "fig", v: raw.slice(measS, mEnd), id: "m" }] });
      if (P.equiv) spans.push({ s: at + P.equiv.innerStart, e: at + P.equiv.e - (P.equiv.form === "paren" ? 1 : 0), segs: [{ t: "fig", v: raw.slice(at + P.equiv.innerStart, at + P.equiv.e - (P.equiv.form === "paren" ? 1 : 0)), id: "q" }] });
      // the equiv span sits inside measE..? no: equiv is after unit and before compound; keep order
    } else {
      var main = measureText(R, P, lo, hi, f, mode, style);
      mainText = main.text; mainVal = main.val;
      volOnly = !!main.vol; kosher = !!main.kosher;
      note = main.note || null; flag = !!main.flag;
      var mainSegs = [{ t: "fig", v: mainText, id: "m", vol: volOnly, flag: flag }];
      if (main.addOf && !/^\s*of\b/i.test(P.rest)) mainSegs.push({ t: "txt", v: " of" });
      if (P.equiv) {
        // the equivalent travels with the main amount, unless the mode picks one side
        var eqText = equivText(R, P, f, mode, style);
        var eqMetric = !!UNITS[P.equiv.m.unit.key].metric, mainMetric = !!(key && UNITS[key] && UNITS[key].metric);
        var wantMetric = mode === "metric";
        var mainOk = mainMetric === wantMetric, eqOk = eqMetric === wantMetric;
        if (mode === "asis" || (mainOk && eqOk)) {
          spans.push({ s: measS, e: at + P.equiv.s, segs: mainSegs.slice(0, 1) });
          spans.push({ s: at + P.equiv.innerStart, e: at + P.equiv.e - (P.equiv.form === "paren" ? 1 : 0), segs: [{ t: "fig", v: eqText, id: "q" }] });
          if (P.compoundEnd) spans.push({ s: at + P.equiv.e, e: measE, segs: [] });
        } else {
          var chosen = eqOk ? eqText : mainText;
          spans.push({ s: measS, e: measE, segs: [{ t: "fig", v: chosen, id: "m" }] });
        }
      } else {
        spans.push({ s: measS, e: measE, segs: mainSegs });
      }
      // count nouns agree with the new number
      if (P.head && !P.unit) {
        var plural = (hi || mainVal) > 1;
        var w = plural ? pluralWord(P.head.word) : singularWord(P.head.word);
        if (w !== P.head.word) spans.push({ s: P.head.s, e: P.head.e, segs: [{ t: "txt", v: w }] });
      }
    }
    // measures and temperatures further along the line
    P.tmeas.forEach(function (tm, k) {
      if (exact) { spans.push({ s: tm.s, e: tm.e, segs: [{ t: "fig", v: raw.slice(tm.s, tm.e), id: "r" + k, size: !tm.scale }] }); return; }
      var b = baseOf(tm.m.q.lo * (tm.scale ? f : 1), tm.m.unit.key);
      var bh = tm.m.q.hi ? baseOf(tm.m.q.hi * (tm.scale ? f : 1), tm.m.unit.key) : null;
      var ingr = P.ingr;
      var r = rangeMeasure(bh ? b : b, bh, dimOf(tm.m.unit.key), tm.m.unit.key, tm.m.unit.tok, ingr, mode, { uni: style.uni, uniSpace: style.uniSpace, long: LONG_RE.test(tm.m.unit.tok), tight: tm.m.gap === "" }, tm.m.q.sep);
      spans.push({ s: tm.s, e: tm.e, segs: [{ t: "fig", v: r.text, id: "r" + k, size: !tm.scale }] });
    });
    P.tcount.forEach(function (tc, k) {
      if (exact) { spans.push({ s: tc.s, e: tc.e, segs: [{ t: "fig", v: raw.slice(tc.s, tc.e), id: "c" + k }] }); return; }
      var cv = formatCount(tc.q.lo * f, style), cflag = false;
      if (tc.egg && !note) { note = egNote(tc.q.lo * f, tc.egg, mode, style); cflag = !!note; }
      spans.push({ s: tc.s, e: tc.e, segs: [{ t: "fig", v: cv.text, id: "c" + k, flag: cflag }] });
      if (tc.head) {
        var w2 = cv.val > 1 ? pluralWord(tc.head.word) : singularWord(tc.head.word);
        if (w2 !== tc.head.word) spans.push({ s: tc.head.s, e: tc.head.e, segs: [{ t: "txt", v: w2 }] });
      }
    });
    P.temps.forEach(function (t, k) {
      var segsT = withTemps(raw, t.s, t.e, [{ s: t.s, e: t.e, n: t.n, unit: t.unit }], mode, exact);
      segsT.forEach(function (sg) { if (sg.id) sg.id = "i" + k + sg.id; });
      spans.push({ s: t.s, e: t.e, segs: segsT });
    });

    spans.sort(function (a, b) { return a.s - b.s; });
    var segs = [], pos = 0;
    spans.forEach(function (sp) {
      if (sp.s < pos) return;
      if (sp.s > pos) segs.push({ t: "txt", v: raw.slice(pos, sp.s) });
      segs = segs.concat(sp.segs);
      pos = sp.e;
    });
    if (pos < raw.length) segs.push({ t: "txt", v: raw.slice(pos) });

    // what "I have this much" needs to know
    if (!P.q.word || P.q.lo > 0) {
      if (dim !== "pinch") have = { dim: dim, base: baseOf(P.q.lo, key) + (P.compound || 0), unit: key, ingr: P.ingr, egg: P.egg };
    }
    return { segs: segs, kind: "ing", note: note, flag: flag, vol: volOnly, kosher: kosher, have: have, egg: P.egg, dim: dim, unit: key };
  }

  var RE_NUMPART = /^[\d\s\/.,\u00bd\u2153\u2154\u00bc\u00be\u215b\u215c\u215d\u215e]+/;
  function numPart(t) { var m = t.match(RE_NUMPART); return m ? m[0].replace(/\s+$/, "") : ""; }

  // The number alone for a base amount in a given unit, for the low end of
  // a range that has to share the high end's unit ("4 to 6 tbsp").
  function forceNum(base, unit, style) {
    var u = UNITS[unit];
    if (!u) return "";
    var v = u.dim === "vol" ? base / u.ml : u.dim === "wt" ? base / u.g : unit === "stick" ? base / (24 * TSP_ML) : base;
    var set = unit === "cup" ? FR_CUP : unit === "tsp" ? FR_TSP : unit === "tbsp" || unit === "floz" ? FR_HALF : unit === "oz" ? (v < 4 ? FR_QUARTER : FR_HALF) : FR_QUARTER;
    if (u.metric) {
      if (unit === "l" || unit === "kg") return trimNum(Math.round(v * 100) / 100, 2);
      return trimNum(roundMetric(v), 1);
    }
    var f = nearest(v, set);
    return f.val > 0 ? fracText(f, style) : "";
  }

  function rangeMeasure(lo, hi, dim, key, tok, ingr, mode, style, sep) {
    var a = formatMeasure(lo, dim, key, tok, ingr, mode, style);
    if (!hi || !a) return a || { text: "" };
    var b = formatMeasure(hi, dim, key, tok, ingr, mode, style);
    var joined = sep && /to|or/i.test(sep) ? sep : " to ";
    if (a.parts === 2 || b.parts === 2 || a.pinch || b.pinch || b.approx) {
      return { text: a.text + joined + b.text, unit: b.unit, val: b.val, vol: b.vol, kosher: b.kosher };
    }
    var loNum = a.unit === b.unit && !a.approx ? numPart(a.text) : forceNum(lo, b.unit, style);
    var hiNum = numPart(b.text);
    if (!loNum || !hiNum || loNum === hiNum) return { text: a.text + joined + b.text, unit: b.unit, val: b.val, vol: b.vol, kosher: b.kosher };
    return { text: loNum + (sep || "-") + hiNum + b.text.slice(b.text.indexOf(hiNum) + hiNum.length), unit: b.unit, val: b.val, vol: b.vol, kosher: b.kosher };
  }

  function measureText(R, P, lo, hi, f, mode, style) {
    var key = P.unit ? P.unit.key : null, dim = P.dim, tok = P.unit ? P.unit.tok : "";
    var out;
    if (dim === "vol" || dim === "wt" || dim === "stick") {
      var b = baseOf(P.q.lo, key) * f + (P.compound || 0) * f;
      var bh = P.q.hi ? baseOf(P.q.hi, key) * f + (P.compound || 0) * f : null;
      out = rangeMeasure(b, bh, dim, key, tok, P.ingr, mode, style, P.q.sep);
      if (P.mod && out.text && !out.approx && !out.pinch) {
        var loose = /^(?:heaping|heaped|scant|level|rounded|generous|good|big)\b/i.test(P.mod.text);
        var np = numPart(out.text);
        if (np && out.parts !== 2 && (out.unit === key || !loose)) {
          // keep it next to its unit: "4 heaping tbsp", "1/2 packed cup"
          out.text = np + " " + P.mod.text + out.text.slice(np.length).replace(/^\s+/, "");
        } else if (out.parts !== 2) {
          out.text = "a " + P.mod.text.toLowerCase() + out.text;   // "a heaping 1/4 cup"
        }
      }
      if (out.pinch) out.addOf = true;
      return out;
    }
    if (dim === "pinch") {
      var n = Math.round(lo);
      var word;
      if (lo < 0.75) word = (P.q.word ? matchCase(P.q.text, "a") : "a") + " small " + inflectTok(tok, false);
      else if (n <= 1) word = (P.q.word ? P.q.text : "1") + " " + inflectTok(tok, false);
      else word = n + " " + inflectTok(tok, true);
      return { text: word, val: Math.max(1, n) };
    }
    // counts: eggs, onions, cans, cloves
    var c = formatCount(lo, style), ch = hi ? formatCount(hi, style) : null;
    var text = c.text + (ch ? (P.q.sep || "-") + ch.text : "");
    var flag = false, note = null;
    var val = ch ? ch.val : c.val;
    if (P.egg && !hi) {
      note = egNote(lo, P.egg, mode, style);
      flag = !!note;
    }
    if (P.size) {
      var sz = formatSize(P.size.m, mode, style);
      var sizeTxt = sz ? (P.size.m.lead || "") + sz + (P.size.text.slice(P.size.m.len) || "") : P.size.text;
      var unitPart = P.unit ? (P.unit.gap || " ") + (P.mod ? P.mod.text : "") + inflectTok(tok, val > 1) : "";
      if (P.size.form === "x") text = text + P.size.sep + sizeTxt + unitPart;
      else if (P.size.form === "inline" && !sz) text = text + P.size.sp + sizeTxt + unitPart;
      else if (P.size.form === "paren-after") text = text + unitPart + " (" + sizeTxt + ")";
      else text = text + " (" + sizeTxt + ")" + unitPart;
      // half a can: say how much that really is
      var part = lo - Math.floor(lo + 1e-9);
      if (!hi && part > 0.12 && part < 0.88 && P.unit && PACK[P.unit.key]) {
        var su = P.size.m.unit, u = UNITS[su.key];
        var tot = P.size.m.q.lo * lo, totTxt;
        var toMetric = mode === "metric" && !u.metric, toUS = mode === "us" && u.metric;
        if (toMetric) totTxt = u.dim === "wt" ? Math.round(tot * u.g) + " g" : Math.round(tot * u.ml) + " ml";
        else if (toUS) totTxt = u.dim === "wt" ? trimNum(Math.round(tot * u.g / OZ_G * 2) / 2, 1) + " oz" : trimNum(Math.round(tot * u.ml / UNITS.floz.ml * 2) / 2, 1) + " fl oz";
        else totTxt = trimNum(u.metric ? Math.round(tot) : Math.round(tot * 2) / 2, 1) + (P.size.m.gap === "" && u.metric ? "" : " ") + (u.metric ? su.tok.replace(/\.$/, "") : inflectTok(su.tok, tot > 1));
        note = "That's " + totTxt + " in all: open " + Math.ceil(lo) + " and save the rest";
        flag = true;
      }
    } else if (P.unit) {
      // "2-inch piece" stays singular: the hyphen makes it an adjective
      text = text + (P.unit.gap || " ") + (P.mod ? P.mod.text : "") + (P.unit.gap === "-" ? tok : inflectTok(tok, val > 1));
      var pt = lo - Math.floor(lo + 1e-9);
      if (!hi && pt > 0.12 && pt < 0.88 && PACK[P.unit.key]) {
        // a yeast packet is 2 1/4 tsp (7 g); anything else is opened and part-used
        if (P.unit.key === "packet" && /\byeast\b/i.test(P.rest)) note = "That's " + partsText(usVolParts(lo * 2.25), style) + " of yeast (about " + trimNum(Math.round(lo * 7 * 2) / 2, 1) + " g)";
        else note = "Open " + Math.ceil(lo) + ", use " + formatCount(lo, style).text + " and save the rest";
        flag = true;
      }
    }
    return { text: text, val: val, note: note, flag: flag };
  }

  function equivText(R, P, f, mode, style) {
    var m = P.equiv.m, key = m.unit.key;
    var st = { uni: style.uni, uniSpace: style.uniSpace, long: LONG_RE.test(m.unit.tok), tight: m.gap === "" };
    var b = baseOf(m.q.lo, key) * f, bh = m.q.hi ? baseOf(m.q.hi, key) * f : null;
    var ingr = P.ingr;
    var r = rangeMeasure(b, bh, dimOf(key), key, m.unit.tok, ingr, mode === "asis" ? "asis" : (UNITS[key].metric ? "metric" : "us"), st, m.q.sep);
    return (m.lead || "") + r.text;
  }

  // fine: thirds are allowed (2/3 of a loaf); servings stay in halves
  function formatYieldNum(v, style, fine) {
    var r = Math.round(v);
    if (Math.abs(v - r) < 0.05 && r >= 1) return { text: String(r), approx: false, val: r };
    if (v >= 10) return { text: String(r), approx: true, val: r };
    var f = nearest(v, fine && v < 3 ? FR_COUNT : FR_HALF);
    if (f.val === 0) f = { w: 0, n: 1, d: 4, val: 0.25 };
    return { text: fracText(f, style || {}), approx: Math.abs(f.val - v) > 0.02, val: f.val };
  }

  // "Yield: 1 loaf (12 slices)": the count, its noun, and any count in parentheses
  var RE_YIELD_EXTRA = /\((?:about |makes |approx\.? |or )?(\d+)(?:( ?(?:-|\u2013|to) ?)(\d+))? +[a-z]/gi;
  function yieldIsFine(y) { return !!y.noun && !/^(?:serves|servings?|feeds|portions?)$/i.test(y.verb) && !/^(?:servings?|people|persons?|portions?)$/i.test(y.noun); }
  function renderYield(R, L, f, mode) {
    var y = L.y, raw = L.raw, exact = f === 1;
    var spans = [];
    var fine = yieldIsFine(y);
    var a = formatYieldNum(y.n * f, R.style, fine), b = y.hi ? formatYieldNum(y.hi * f, R.style, fine) : null;
    var lead = raw.slice(0, y.s);
    if (!exact && (a.approx || (b && b.approx)) && !y.about) lead = lead + "about ";
    spans.push({ s: 0, e: y.s, segs: [{ t: "txt", v: lead }] });
    spans.push({ s: y.s, e: y.e, segs: [{ t: "fig", v: exact ? raw.slice(y.s, y.e) : a.text + (b ? y.sep + b.text : ""), id: "y" }] });
    if (!exact && y.head && !y.dozen) {
      var plural = (b ? b.val : a.val) > 1;
      var w = plural ? pluralWord(y.head.word) : singularWord(y.head.word);
      if (w !== y.head.word) spans.push({ s: y.head.s, e: y.head.e, segs: [{ t: "txt", v: w }] });
    }
    var m, k = 0;
    RE_YIELD_EXTRA.lastIndex = 0;
    var tail = raw.slice(y.e);
    while ((m = RE_YIELD_EXTRA.exec(tail))) {
      var ns = y.e + m.index + m[0].indexOf(m[1]);
      var ne = ns + m[1].length + (m[2] ? m[2].length + m[3].length : 0);
      var t;
      if (exact) t = raw.slice(ns, ne);
      else {
        var x1 = formatYieldNum(+m[1] * f, R.style), x2 = m[3] ? formatYieldNum(+m[3] * f, R.style) : null;
        t = x1.text + (x2 ? m[2] + x2.text : "");
      }
      spans.push({ s: ns, e: ne, segs: [{ t: "fig", v: t, id: "y" + (++k) }] });
    }
    spans.sort(function (p, q) { return p.s - q.s; });
    var segs = [], pos = 0;
    spans.forEach(function (sp) {
      if (sp.s < pos) return;
      if (sp.s > pos) segs.push({ t: "txt", v: raw.slice(pos, sp.s) });
      segs = segs.concat(sp.segs);
      pos = sp.e;
    });
    if (pos < raw.length) segs.push({ t: "txt", v: raw.slice(pos) });
    return { segs: segs, kind: "yield" };
  }

  function render(R, f, mode) {
    return R.lines.map(function (L) {
      var r = renderLine(R, L, f, mode);
      r.i = L.i;
      r.text = r.segs.map(function (s) { return s.v; }).join("");
      return r;
    });
  }

  function toText(rendered) {
    return rendered.map(function (r) {
      return r.text + (r.note ? " (" + r.note + ")" : "");
    }).join("\n");
  }

  /* ------------------------------------------------------------- "I have" */

  // Convert "I have 200 g" into the line's own dimension, so the scale factor
  // is just have / needed. Returns NaN when the units cannot meet.
  function haveFactor(have, value, unitKey) {
    if (!have || !(value > 0)) return NaN;
    if (have.dim === "count" || !unitKey) return value / have.base;
    var u = UNITS[unitKey];
    var gpc = have.ingr && have.ingr.gpc;
    var mine;
    if (have.dim === "vol" || have.dim === "stick") {
      if (unitKey === "stick") mine = value * 24 * TSP_ML;
      else if (u.dim === "vol") mine = value * u.ml;
      else if (u.dim === "wt" && gpc) mine = value * u.g / gpc * CUP_ML;
      else return NaN;
    } else if (have.dim === "wt") {
      if (u.dim === "wt") mine = value * u.g;
      else if (u.dim === "vol" && gpc) mine = value * u.ml / CUP_ML * gpc;
      else if (unitKey === "stick") mine = value * 113.4;
      else return NaN;
    } else return NaN;
    return mine / have.base;
  }

  function haveUnits(have) {
    if (!have) return [];
    var gpc = have.ingr && have.ingr.gpc && have.ingr.kind !== "liquid";
    if (have.dim === "count") return [];
    if (have.dim === "stick") return ["stick", "tbsp", "cup", "g"];
    if (have.dim === "vol") return ["tsp", "tbsp", "cup", "ml"].concat(gpc ? ["g", "oz"] : []);
    if (have.dim === "wt") return ["g", "kg", "oz", "lb"].concat(gpc ? ["cup"] : []);
    return [];
  }

  /* --------------------------------------------------------- the factor */

  function factorLabel(f) {
    var words = { 0.5: "Halved", 2: "Doubled", 3: "Tripled", 4: "Quadrupled" };
    for (var k in words) if (Math.abs(f - k) < 0.005) return { word: words[k], mult: "×" + fracText(nearest(+k, FR_COUNT), {}) };
    var n = nearest(f, FR_COUNT);
    var close = Math.abs(n.val - f) < 0.01;
    return { word: null, mult: "×" + (close ? fracText(n, {}) : trimNum(f, 2)) };
  }

  var api = {
    parseRecipe: parseRecipe, parseIngredient: parseIngredient, parseYield: parseYield,
    render: render, toText: toText, renderLine: renderLine,
    readQty: readQty, numValue: numValue, matchUnit: matchUnit, lookup: lookup,
    usVolParts: usVolParts, partsText: partsText, formatMeasure: formatMeasure, formatCount: formatCount,
    formatYieldNum: formatYieldNum, yieldIsFine: yieldIsFine, convertTemp: convertTemp, findTemps: findTemps,
    haveFactor: haveFactor, haveUnits: haveUnits, factorLabel: factorLabel,
    pluralWord: pluralWord, singularWord: singularWord, inflectTok: inflectTok,
    fracText: fracText, nearest: nearest, FR_COUNT: FR_COUNT,
    UNITS: UNITS, DENSITY: DENSITY, TSP_ML: TSP_ML, CUP_ML: CUP_ML, OZ_G: OZ_G
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.RecipeScaler = api;
})(typeof window !== "undefined" ? window : this);
