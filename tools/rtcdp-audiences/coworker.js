// Builds the "Learn more with Coworker" prompt for an audience.

const IRREGULAR = {
  people: 'person', men: 'man', women: 'woman', children: 'child', alumni: 'alumnus',
};
const UNCHANGED = /(ss|us|is|news|series|species|plus|always|data)$/i;

function matchCase(source, word) {
  if (source === source.toUpperCase()) return word.toUpperCase();
  if (source[0] === source[0].toUpperCase()) return word[0].toUpperCase() + word.slice(1);
  return word;
}

export function singularize(word) {
  const lower = word.toLowerCase();
  if (IRREGULAR[lower]) return matchCase(word, IRREGULAR[lower]);
  if (word.length < 4 || UNCHANGED.test(word) || !/s$/i.test(word)) return word;
  if (/[^aeiou]ies$/i.test(word)) return `${word.slice(0, -3)}${matchCase(word.slice(-3, -2), 'y')}`;
  if (/(ches|shes|sses|xes|zes)$/i.test(word)) return word.slice(0, -2);
  return word.slice(0, -1);
}

// Audience names are plural group labels ("Fitness Fuel Seekers", "Cart Abandoners – Last 7 Days").
// The persona is the singular head noun: the last word before any qualifier such as " – ", " - " or " (".
export function singularAudienceName(name = '') {
  const trimmed = String(name).trim();
  const qualifierAt = trimmed.search(/\s[–—-]\s|\s\(|:\s/);
  const head = qualifierAt === -1 ? trimmed : trimmed.slice(0, qualifierAt);
  const rest = qualifierAt === -1 ? '' : trimmed.slice(qualifierAt);
  const match = head.match(/^(.*?)([A-Za-z]+)$/);
  if (!match) return trimmed;
  return `${match[1]}${singularize(match[2])}${rest}`;
}

export function coworkerPrompt(audienceName) {
  return `Tell me more about the CDP Audience '${singularAudienceName(audienceName)}' including the persona rules from Experience Context. `;
}
