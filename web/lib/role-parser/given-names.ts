// Bundled given-name reference set for inversion detection.
//
// This is intentionally not exhaustive: we only need enough coverage to
// detect prénom/nom inversions with high precision. False negatives (failing
// to detect that a name IS a given name) are tolerable; false positives
// (treating a surname as a given name) are not.
//
// Sources: French-Canadian, Italian, Portuguese, Lebanese, Persian,
// Romanian, Greek, Sephardic Jewish, English. Compound French given names
// (Marie-Claire, Jean-Baptiste) are stored as single hyphenated tokens AND
// as their parts so we can recognize "Marie Claire" without a hyphen too.
//
// Lookup is accent-folded + lowercased. All entries below are stored
// already folded.

const RAW: string[] = [
  // ─── Common French / French-Canadian given names ─────────────────────
  "alain", "alex", "alexandre", "alexandra", "alexis", "amelie", "amelia", "andre", "andree", "annick", "antoine", "anthony", "armand",
  "benoit", "bertrand", "bernard", "blandine", "brigitte", "bruno",
  "camille", "carole", "caroline", "catherine", "celine", "charles", "charlotte", "chantal", "christian", "christiane", "christine", "christophe",
  "claire", "claude", "claudette", "claudia", "claudine", "claudio", "constance", "cyrille",
  "daniel", "danielle", "david", "denis", "denise", "diane", "didier", "dominique",
  "edmond", "edouard", "eddie", "eddy", "edward", "edith", "elaine", "eric", "emilie", "etienne", "evelyne",
  "fabien", "ferne", "fernand", "florence", "florent", "francois", "francoise", "francine", "frederic", "frederick",
  "gabriel", "gabrielle", "gaetan", "gaetane", "gaston", "genevieve", "georges", "georgette", "germain", "germaine", "ghislain", "ghislaine", "gilbert", "gilberte", "gilles", "gilbert", "ginette",
  "guillaume", "guy", "guylaine", "henri", "helene",
  "isabelle", "jacqueline", "jacques", "jean", "jean-baptiste", "jean-claude", "jean-francois", "jean-louis", "jean-luc", "jean-marc", "jean-marie",
  "jean-michel", "jean-paul", "jean-pierre", "jean-philippe", "jean-pascal", "jean-sebastien", "jean-yves",
  "jeannette", "jeannine", "jeanne", "jerome", "joanne", "johanne", "joel", "joelle", "jonathan", "joseph", "josephine", "josee", "judith", "julien", "julie", "juliette",
  "karine", "katherine", "kim",
  "laurent", "leon", "leonie", "leopold", "lina", "lise", "lorraine", "louis", "louise", "louis-alexandre", "luc", "lucie", "lucien", "ludivine", "lyne",
  "madeleine", "manon", "marc", "marc-andre", "marcel", "marcelle", "marco", "marguerite", "marguerite", "marianne", "marie",
  "marie-andree", "marie-anne", "marie-claire", "marie-claude", "marie-eve", "marie-france", "marie-helene", "marie-josee", "marie-laure", "marie-line", "marie-louise", "marie-pierre", "marie-rose",
  "marielle", "marilyn", "marina", "mario", "marius", "martine", "mathieu", "maxime", "melanie", "michel", "micheline", "michelle", "monique", "muriel",
  "nadia", "nadine", "natacha", "nathalie", "nicolas", "nicole", "noel", "noelle",
  "olivier", "olivia",
  "pascal", "pascale", "patricia", "patrick", "paul", "paul-yvan", "paulette", "philippe", "pierre", "pierrette",
  "rachel", "raoul", "raymond", "raymonde", "real", "rejean", "renald", "rene", "renee", "richard", "robert", "roberta", "roger", "rolande", "rose", "rose-mary", "rosaire",
  "samuel", "sandra", "sebastien", "serge", "simon", "sophie", "stephane", "stephanie", "suzanne", "sylvain", "sylvie",
  "therese", "thomas", "tina", "tony",
  "valerie", "veronique", "victor", "victoria", "vincent", "viviane", "vivianne",
  "yves", "yvon", "yvonne",

  // ─── Italian / Sicilian common ─────────────────────────────────────
  "antonio", "antonella", "carmela", "carmine", "domenico", "donato", "elena", "fabio", "francesca", "franco", "giorgio", "giovanni",
  "giuseppe", "lorenzo", "luigi", "marco", "maria", "massimo", "matteo", "michele", "nicola", "paolo", "pietro",
  "roberto", "roberta", "salvatore", "salvador", "sandra", "silvana", "stefano", "umberto", "vincenzo",

  // ─── Portuguese / Brazilian common ─────────────────────────────────
  "amilcar", "ana", "antonio", "carlos", "cristina", "fernando", "fernanda", "joao", "jorge", "manuel", "miguel", "paula", "pedro", "rui", "sandra",

  // ─── Lebanese / Arabic common ──────────────────────────────────────
  "ahmed", "ali", "amal", "anwar", "antoine", "elie", "fadi", "farah", "ghassan", "hassan", "hadi", "joseph", "khaled",
  "leila", "lina", "maroun", "michel", "milad", "mohammed", "mona", "nabil", "naji", "nassim", "nouhad", "omar", "rami", "rana", "samia", "samir", "sami", "tania", "tony", "youssef", "zeina", "zyad",

  // ─── Persian common ─────────────────────────────────────────────────
  "ali", "amir", "arash", "arman", "babak", "bardia", "bita", "darioush", "fariborz", "farid", "farzaneh",
  "hossein", "kamran", "leila", "mahdi", "mahmoud", "majid", "maryam", "mehdi", "mohsen", "mona",
  "morteza", "nasim", "navid", "neda", "negin", "omid", "parisa", "payam", "pooria", "reza", "saeed", "sara", "shahram", "shahriar", "siamak", "soheila", "soroush", "tara", "vahid", "yasaman",

  // ─── Romanian common ────────────────────────────────────────────────
  "adrian", "alexandra", "alexandru", "andrei", "andreea", "constantin", "cristian", "cristina", "daniela", "elena", "florin",
  "ioan", "ion", "ionut", "marius", "mihai", "mihaela", "nicolae", "petre", "radu", "stefan", "vasile", "viorica",

  // ─── Greek common ───────────────────────────────────────────────────
  "alexandros", "andreas", "anna", "antonis", "christos", "constantinos", "demetrios", "dimitrios", "dimitra", "eleni", "evangelos",
  "georgios", "ioannis", "konstantinos", "maria", "michalis", "nikos", "pavlos", "petros", "spyros", "stavros", "vasilis",

  // ─── Sephardic Jewish / Hebrew common ──────────────────────────────
  "aaron", "abraham", "ariel", "avi", "benjamin", "daniel", "david", "elie", "esther", "ezra", "isaac", "jacob", "joseph",
  "leah", "miriam", "moshe", "nathan", "rachel", "rebecca", "samuel", "sarah", "shalom", "yaakov", "yael",

  // ─── English / North-American common ───────────────────────────────
  "adam", "alan", "albert", "amanda", "andrew", "ann", "anne", "anthony", "ashley", "benjamin", "brenda", "brian", "carol",
  "catherine", "charles", "christopher", "daniel", "david", "deborah", "donald", "donna", "douglas", "elizabeth", "emily", "ethan",
  "frank", "gary", "george", "gerald", "gregory", "harold", "harry", "helen", "henry", "ian", "jack", "james", "janet", "jason",
  "jeffrey", "jennifer", "jessica", "joan", "john", "joseph", "joshua", "joyce", "judith", "karen", "kathleen", "kenneth", "kevin",
  "kimberly", "larry", "laura", "linda", "lisa", "margaret", "mark", "martin", "mary", "matthew", "melissa", "michael", "michelle",
  "nancy", "nicholas", "patricia", "paul", "peter", "raymond", "rebecca", "richard", "robert", "roger", "ronald", "russell",
  "ruth", "samuel", "sandra", "sarah", "scott", "sharon", "steven", "susan", "thomas", "timothy", "virginia", "william",

  // ─── Chinese (pinyin) common ───────────────────────────────────────
  "bo", "chen", "cheng", "chun", "fang", "feng", "guang", "hai", "hao", "hong", "hua", "hui", "jian", "jie", "jin", "jing",
  "jun", "jun xia", "li", "lin", "ling", "ming", "ping", "qiang", "qing", "rong", "rui", "shan", "tao", "wei", "wen", "xia",
  "xiao", "xiu", "yan", "yang", "yi", "ying", "yong", "yu", "yue", "yun", "zhao", "zhe", "zhi", "zhong",
];

const SET = new Set(RAW.map(s => s.toLowerCase()));

/** Check whether a token (already lower-cased, accent-folded) is a known given name. */
export function isKnownGivenName(token: string): boolean {
  return SET.has(token.toLowerCase());
}

/** Quick lookup variants — useful when callers haven't folded yet. */
export function isLikelyGivenName(value: string | null | undefined): boolean {
  if (!value) return false;
  const folded = value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
  if (!folded) return false;
  if (SET.has(folded)) return true;
  // Hyphenated compound: "marie-claire", "jean-baptiste" etc. Try each part.
  if (folded.includes("-")) {
    const parts = folded.split("-").filter(Boolean);
    // Hyphenated compound prénoms count as given names if at least one half is one.
    if (parts.some(p => SET.has(p))) return true;
  }
  return false;
}

/** Heuristic: does a multi-token string LOOK like a compound prénom (e.g. "Marie Claire")? */
export function isLikelyCompoundGivenName(value: string): boolean {
  const folded = value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
  const tokens = folded.split(/\s+/).filter(Boolean);
  if (tokens.length !== 2) return false;
  // Both tokens must be known given names AND the pair is a recognized compound shape.
  // We use a small allowlist to avoid false positives like "Pierre Tremblay".
  const KNOWN_COMPOUNDS = new Set([
    "marie claire", "marie andree", "marie eve", "marie helene", "marie josee", "marie line", "marie pierre", "marie rose",
    "jean baptiste", "jean paul", "jean pierre", "jean claude", "jean francois", "jean luc", "jean louis", "jean marc",
    "jean michel", "jean philippe", "jean yves", "jean pascal",
    "louis alexandre", "rose mary", "paul yvan",
    "jun xia", // Chinese disyllabic given name common in MTL files
  ]);
  return KNOWN_COMPOUNDS.has(`${tokens[0]} ${tokens[1]}`);
}
