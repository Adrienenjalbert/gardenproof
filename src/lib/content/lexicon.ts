/**
 * Landscaping lexicon + deterministic fact extraction from crew notes.
 *
 * Why: demo mode (no API key) must still produce specific copy, and the eval/lint layers need a
 * shared notion of "concrete material or feature". Everything returned here is a phrase that
 * literally appears in the crew notes (lightly normalised) — nothing is invented.
 */
import { fixProperNouns, parseDuration, sentences } from "./text";

type Entry = { term: string; re: RegExp; overrides?: string[] };

export const MATERIALS: Entry[] = [
  { term: "Indian sandstone", re: /\bindian sandstone\b/i },
  { term: "sandstone", re: /\bsandstone\b/i, overrides: ["Indian sandstone"] },
  { term: "porcelain", re: /\bporcelain\b/i },
  { term: "limestone", re: /\blimestone\b/i },
  { term: "York stone", re: /\byork ?stone\b/i },
  { term: "granite setts", re: /\bgranite setts?\b/i },
  { term: "granite", re: /\bgranite\b/i, overrides: ["granite setts"] },
  { term: "slate", re: /\bslate\b/i },
  { term: "red brick", re: /\bred brick\b/i },
  { term: "reclaimed brick", re: /\breclaimed brick\b/i },
  { term: "brick", re: /\bbrick/i, overrides: ["red brick", "reclaimed brick"] },
  { term: "self-binding gravel", re: /\bself[- ]binding gravel\b/i },
  { term: "resin-bound gravel", re: /\bresin[- ]bound\b/i },
  { term: "gravel", re: /\bgravel\b/i, overrides: ["self-binding gravel", "resin-bound gravel"] },
  { term: "oak", re: /\boak\b/i },
  { term: "cedar", re: /\bcedar\b/i },
  { term: "larch", re: /\blarch\b/i },
  { term: "hardwood decking", re: /\bhardwood deck/i },
  { term: "composite decking", re: /\bcomposite deck/i },
  { term: "timber", re: /\b(timber|wooden)\b/i, overrides: ["oak", "cedar", "larch", "hardwood decking"] },
  { term: "railway sleepers", re: /\b(railway sleepers?|sleepers)\b/i },
  { term: "rendered blockwork", re: /\brendered block(work)?\b/i },
  { term: "Corten steel", re: /\bcorten\b/i },
  { term: "turf", re: /\b(turf|turfed|turfing)\b/i },
];

export const PLANTS: Entry[] = [
  { term: "pleached hornbeam", re: /\bpleached hornbeams?\b/i },
  { term: "hornbeam", re: /\bhornbeams?\b/i, overrides: ["pleached hornbeam"] },
  { term: "box balls", re: /\b(box balls|buxus)\b/i },
  { term: "yew", re: /\byews?\b/i },
  { term: "lavender", re: /\blavender\b/i },
  { term: "hydrangeas", re: /\bhydrangeas?\b/i },
  { term: "magnolia", re: /\bmagnolias?\b/i },
  { term: "olive tree", re: /\bolive trees?\b/i },
  { term: "Japanese maple", re: /\b(japanese maples?|acers?)\b/i },
  { term: "ornamental grasses", re: /\b(ornamental )?grasses\b/i },
  { term: "ferns", re: /\bferns?\b/i },
  { term: "roses", re: /\broses?\b/i },
  { term: "alliums", re: /\balliums?\b/i },
  { term: "pittosporum", re: /\bpittosporums?\b/i },
  { term: "star jasmine", re: /\b(star )?jasmine\b/i },
  { term: "wisteria", re: /\bwisteria\b/i },
  { term: "agapanthus", re: /\bagapanthus\b/i },
  { term: "salvias", re: /\bsalvias?\b/i },
  { term: "euphorbia", re: /\beuphorbias?\b/i },
  { term: "silver birch", re: /\b(silver )?birch(es)?\b/i },
  { term: "beech hedging", re: /\bbeech hedg/i },
  { term: "photinia", re: /\bphotinia\b/i },
  { term: "laurel", re: /\blaurels?\b/i },
];

/** Built/landscape elements. Order = display priority (structural first, lawn and borders last). */
export const FEATURE_HEADS = [
  "garden room", "outdoor kitchen", "water feature", "retaining wall", "raised beds", "raised bed", "stepping stones",
  "seating area", "fire pit", "pleached trees", "hornbeam", "patio", "terrace", "pond", "rill", "fountain", "pergola", "arbour",
  "decking", "deck", "summerhouse", "pathway", "path", "steps", "band", "edging", "fence", "fencing", "trellis",
  "screening", "planters", "lighting", "hedge", "hedging", "lawn", "borders", "trees",
] as const;

const PRIMARY_HEADS: Record<string, string[]> = {
  patio_paving: ["patio", "terrace", "paving", "path", "pathway"],
  full_design: ["pond", "patio", "terrace", "garden room", "water feature"],
  fencing: ["fence", "fencing", "trellis", "screening"],
  lawn_turf: ["lawn"],
  planting: ["hornbeam", "pleached trees", "hedge", "hedging", "borders", "planters"],
  structures: ["garden room", "pergola", "raised beds", "water feature", "summerhouse", "arbour"],
  maintenance: ["lawn", "hedge", "borders"],
};

/** A head right after these (optionally + article) is a location reference, not work done: "along the back fence". */
const REF_PREPS = new Set([
  "along", "beside", "by", "to", "from", "behind", "around", "against", "near", "under", "onto", "into", "through",
  "past", "for", "across", "over", "towards", "down", "outside", "off",
]);

/** Skipped when looking for that preposition: "along the back fence", "to the new lawn". */
const SOFT_WORDS = new Set(["a", "an", "the", "back", "front", "side", "rear", "new", "old", "existing", "whole"]);
/** "Built the base for a garden room": the base is the work, not the room. */
const GROUNDWORK = new Set(["base", "foundations", "footings", "slab", "groundwork"]);

const STOP_MODIFIERS = new Set([
  "a", "an", "the", "and", "with", "of", "in", "at", "to", "for", "on", "new", "old", "some", "our", "their", "it",
  "two", "three", "four", "five", "six", "laid", "built", "installed", "added", "planted", "kept", "put", "fitted",
  "created", "cleared", "cleaned", "up", "back", "front", "whole", "all", "plus", "then", "also", "nice", "big",
  "small", "little", "lovely", "proper", "each", "both",
]);

const BEFORE_MARKERS =
  /\b(overgrown|neglected|junk|rubbish|derelict|tired|rotten|rotting|broken|cracked|uneven|waterlogged|boggy|bare|knee-high|weeds?|dated|collapsed|falling down|was a|used to|sloped badly|mess)\b/i;
/** Verbs that mean new work went in. Clearance verbs (cleared, removed, took up) do not count. */
const BUILD_VERBS =
  /\b(laid|built|installed|added|planted|created|fitted|put in|kept|cleaned up|turfed|levelled|replaced|rebuilt|repointed|designed|finished)\b/i;
const CLEARANCE = /^(?:cleared|removed|took up|dug out|ripped out|stripped out)\s+|\s+(?:cleared|removed|taken up|ripped out)$/i;

const STYLES = /\b(contemporary|modern|cottage|formal|naturalistic|japanese|mediterranean|minimalist|traditional|wildlife)\b/i;

export type ExtractedFacts = {
  features: string[];
  materials: string[];
  plants: string[];
  durationDays: number | null;
  durationText: string | null;
  challenge: string | null;
  style: string | null;
  /** Crew-note clauses describing the finished scope, in the crew's own order. */
  scope: string[];
};

function matchEntries(text: string, entries: Entry[]): string[] {
  const hits = entries.filter((e) => e.re.test(text)).map((e) => e.term);
  return hits.filter((t) => !entries.find((e) => e.term === t)?.overrides?.some((o) => hits.includes(o)));
}

/** Split into clauses on commas/semicolons and on " and <verb>" joins. */
export function clauses(sentence: string): string[] {
  return sentence
    .replace(/[.!?]+$/, "")
    .split(/\s*[,;]\s*|\s+and\s+(?=(?:a|an|the)\s+(?!half\b)|(?:laid|built|installed|added|planted|kept|cleaned|cleared|removed|put|fitted|created|replaced|finished|mulched)\b)/i)
    .map((c) => c.trim().replace(/^(?:and|then|plus|also)\s+/i, ""))
    .filter(Boolean);
}

/** Noun phrases ending in a known head, keeping up to 3 descriptive modifiers from the notes. */
function featurePhrases(clause: string): string[] {
  const words = clause.split(/\s+/);
  const lower = words.map((w) => w.toLowerCase().replace(/[^a-z-]/g, ""));
  const out: string[] = [];
  for (let i = 0; i < words.length; i++) {
    for (const head of FEATURE_HEADS) {
      const hw = head.split(" ");
      if (hw.every((w, k) => lower[i + k] === w)) {
        const mods: string[] = [];
        let j = i - 1;
        for (; j >= 0 && mods.length < 3; j--) {
          if (STOP_MODIFIERS.has(lower[j]) || /^\d/.test(lower[j]) || !lower[j]) break;
          mods.unshift(words[j].replace(/[^A-Za-z-]/g, ""));
        }
        let k = j;
        while (k >= 0 && SOFT_WORDS.has(lower[k])) k--;
        const phrase = fixProperNouns([...mods, ...hw].join(" "));
        if (!REF_PREPS.has(lower[k] ?? "")) out.push(phrase);
        else if (lower[k] === "for" && GROUNDWORK.has(lower[k - 1] ?? "")) out.push(`${phrase} ${lower[k - 1]}`); // "base for a garden room"
        i += hw.length - 1;
        break;
      }
    }
  }
  return out;
}

const isBeforeSentence = (s: string) => BEFORE_MARKERS.test(s) && !BUILD_VERBS.test(s);
const beforeState = (s: string) => s.replace(/[.!?]+$/, "").replace(CLEARANCE, "");

export function extractFacts(notes: string | null | undefined): ExtractedFacts {
  const text = (notes ?? "").trim();
  const empty: ExtractedFacts = {
    features: [], materials: [], plants: [], durationDays: null, durationText: null, challenge: null, style: null, scope: [],
  };
  if (!text) return empty;

  const before: string[] = [];
  const scope: string[] = [];
  for (const s of sentences(text)) {
    if (isBeforeSentence(s)) {
      before.push(beforeState(s));
      continue;
    }
    for (const c of clauses(s)) {
      if (parseDuration(c) && c.split(/\s+/).length <= 7) continue; // "About three weeks." is not scope
      if (BEFORE_MARKERS.test(c) && !BUILD_VERBS.test(c)) before.push(beforeState(c));
      else scope.push(c);
    }
  }

  const features: string[] = [];
  for (const c of scope) for (const f of featurePhrases(c)) if (!features.some((x) => x.toLowerCase() === f.toLowerCase())) features.push(f);
  // Remove bare heads when a modified version exists ("lawn" vs "striped lawn").
  const dedup = features.filter((f) => !features.some((g) => g !== f && g.toLowerCase().endsWith(` ${f.toLowerCase()}`)));

  // "the base for a cedar-clad garden room": the room's materials are not this job's work.
  const scopeText = scope.join(". ").replace(/\b(base|foundations|footings|slab) for (?:a |an |the )?[^,.;]+/gi, "$1");
  const duration = parseDuration(text);
  const style = text.match(STYLES)?.[1]?.toLowerCase() ?? null;
  return {
    features: dedup,
    materials: matchEntries(scopeText || text, MATERIALS),
    plants: matchEntries(scopeText || text, PLANTS),
    durationDays: duration?.days ?? null,
    durationText: duration?.text ?? null,
    challenge: before.length ? before.join(", ") : null,
    style: style ? fixProperNouns(style) : null,
    scope,
  };
}

function headOf(feature: string): string {
  const f = feature.toLowerCase().replace(/\s+(base|foundations|footings|slab|groundwork)$/, "");
  return FEATURE_HEADS.find((h) => f.endsWith(h)) ?? f;
}

/** Order features so the one that sells the service comes first (patio for patio jobs, etc.). */
export function rankFeatures(features: string[], service: string): string[] {
  const primary = PRIMARY_HEADS[service] ?? [];
  const score = (f: string) => {
    const h = headOf(f);
    const p = primary.indexOf(h);
    const base = p >= 0 ? p : 100 + (FEATURE_HEADS as readonly string[]).indexOf(h);
    return base - Math.min(f.split(" ").length, 4) * 0.1; // prefer the more descriptive phrase
  };
  return [...features].sort((a, b) => score(a) - score(b));
}

/** Service key -> the noun a homeowner searches for ("patio", "garden design"). */
export const SERVICE_NOUNS: Record<string, string> = {
  full_design: "garden design",
  patio_paving: "patio",
  fencing: "fencing",
  lawn_turf: "new lawn",
  planting: "planting scheme",
  structures: "garden structure",
  maintenance: "garden maintenance",
};

/** Service key -> hashtag for the social pack. */
export const SERVICE_TAGS: Record<string, string> = {
  full_design: "#GardenDesign",
  patio_paving: "#PatioDesign",
  fencing: "#GardenFencing",
  lawn_turf: "#NewLawn",
  planting: "#PlantingDesign",
  structures: "#GardenBuild",
  maintenance: "#GardenMaintenance",
};
