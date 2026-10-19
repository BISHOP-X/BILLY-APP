// Merchandising only. Reorders existing live offers; never adds a service,
// changes stock/prices or chooses its provider. Applied before pagination.
const familiarServices = [
  /\bwhatsapp\b/i,
  /\btelegram\b/i,
  /\b(google|gmail)\b/i,
  /\btiktok\b/i,
  /\binstagram\b/i,
  /\bfacebook\b/i,
  /\b(twitter|x)\b/i,
  /\bsnapchat\b/i,
  /\bdiscord\b/i,
  /\b(apple|icloud)\b/i,
  /\bamazon\b/i,
  /\b(microsoft|outlook)\b/i,
];
function rank(name: string) {
  const index = familiarServices.findIndex((pattern) => pattern.test(name));
  return index < 0 ? familiarServices.length : index;
}
export function compareNumberServices(
  a: { name: string },
  b: { name: string },
) {
  return rank(a.name) - rank(b.name);
}
