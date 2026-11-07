/**
 * Shared heading slug used by the search indexer (section anchors) and by
 * rendered pages (heading `id`s), so `#anchor` links from search results land
 * on the right heading.
 */
export function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 50)
}
