/** Capitals and nicknames, for state trivia in Drive mode. */
import { STATE_NAMES } from "@/lib/state-names";

export const STATE_FACTS: Record<string, { capital: string; nickname: string }> = {
  AL: { capital: "Montgomery", nickname: "the Yellowhammer State" },
  AK: { capital: "Juneau", nickname: "the Last Frontier" },
  AZ: { capital: "Phoenix", nickname: "the Grand Canyon State" },
  AR: { capital: "Little Rock", nickname: "the Natural State" },
  CA: { capital: "Sacramento", nickname: "the Golden State" },
  CO: { capital: "Denver", nickname: "the Centennial State" },
  CT: { capital: "Hartford", nickname: "the Constitution State" },
  DE: { capital: "Dover", nickname: "the First State" },
  FL: { capital: "Tallahassee", nickname: "the Sunshine State" },
  GA: { capital: "Atlanta", nickname: "the Peach State" },
  HI: { capital: "Honolulu", nickname: "the Aloha State" },
  ID: { capital: "Boise", nickname: "the Gem State" },
  IL: { capital: "Springfield", nickname: "the Prairie State" },
  IN: { capital: "Indianapolis", nickname: "the Hoosier State" },
  IA: { capital: "Des Moines", nickname: "the Hawkeye State" },
  KS: { capital: "Topeka", nickname: "the Sunflower State" },
  KY: { capital: "Frankfort", nickname: "the Bluegrass State" },
  LA: { capital: "Baton Rouge", nickname: "the Pelican State" },
  ME: { capital: "Augusta", nickname: "the Pine Tree State" },
  MD: { capital: "Annapolis", nickname: "the Old Line State" },
  MA: { capital: "Boston", nickname: "the Bay State" },
  MI: { capital: "Lansing", nickname: "the Great Lakes State" },
  MN: { capital: "Saint Paul", nickname: "the North Star State" },
  MS: { capital: "Jackson", nickname: "the Magnolia State" },
  MO: { capital: "Jefferson City", nickname: "the Show-Me State" },
  MT: { capital: "Helena", nickname: "the Treasure State" },
  NE: { capital: "Lincoln", nickname: "the Cornhusker State" },
  NV: { capital: "Carson City", nickname: "the Silver State" },
  NH: { capital: "Concord", nickname: "the Granite State" },
  NJ: { capital: "Trenton", nickname: "the Garden State" },
  NM: { capital: "Santa Fe", nickname: "the Land of Enchantment" },
  NY: { capital: "Albany", nickname: "the Empire State" },
  NC: { capital: "Raleigh", nickname: "the Tar Heel State" },
  ND: { capital: "Bismarck", nickname: "the Peace Garden State" },
  OH: { capital: "Columbus", nickname: "the Buckeye State" },
  OK: { capital: "Oklahoma City", nickname: "the Sooner State" },
  OR: { capital: "Salem", nickname: "the Beaver State" },
  PA: { capital: "Harrisburg", nickname: "the Keystone State" },
  RI: { capital: "Providence", nickname: "the Ocean State" },
  SC: { capital: "Columbia", nickname: "the Palmetto State" },
  SD: { capital: "Pierre", nickname: "the Mount Rushmore State" },
  TN: { capital: "Nashville", nickname: "the Volunteer State" },
  TX: { capital: "Austin", nickname: "the Lone Star State" },
  UT: { capital: "Salt Lake City", nickname: "the Beehive State" },
  VT: { capital: "Montpelier", nickname: "the Green Mountain State" },
  VA: { capital: "Richmond", nickname: "the Old Dominion" },
  WA: { capital: "Olympia", nickname: "the Evergreen State" },
  WV: { capital: "Charleston", nickname: "the Mountain State" },
  WI: { capital: "Madison", nickname: "the Badger State" },
  WY: { capital: "Cheyenne", nickname: "the Equality State" },
};

export type TriviaQuestion = { q: string; answer: string; choices: string[]; state: string };

function shuffle<T>(list: T[]) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** A question about the state you just crossed into: its capital, or its nickname. */
export function triviaFor(state: string): TriviaQuestion | null {
  const fact = STATE_FACTS[state];
  const name = STATE_NAMES[state];
  if (!fact || !name) return null;
  const others = shuffle(Object.keys(STATE_FACTS).filter((abbr) => abbr !== state)).slice(0, 2);
  if (Math.random() < 0.5) {
    return { q: `Welcome to ${name}! What's its capital?`, answer: fact.capital, choices: shuffle([fact.capital, ...others.map((abbr) => STATE_FACTS[abbr].capital)]), state };
  }
  return {
    q: `Which state is ${fact.nickname}?`,
    answer: name,
    choices: shuffle([name, ...others.map((abbr) => STATE_NAMES[abbr] ?? abbr)]),
    state,
  };
}
