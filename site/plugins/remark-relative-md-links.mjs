import { posix } from 'node:path';

/**
 * @param {string} url
 * @param {{ path?: string; history?: string[] }} file
 */
export function rewriteRelativeMdLink(url, file = {}) {
  if (!/^\.{1,2}\/.*\.mdx?(#.*)?$/.test(url)) return url;
  const filePath = file.path || file.history?.[0];
  if (!filePath) return url;

  const normalized = filePath.replace(/\\/g, '/');
  const fragmentAt = url.indexOf('#');
  const target = fragmentAt === -1 ? url : url.slice(0, fragmentAt);
  const fragment = fragmentAt === -1 ? '' : url.slice(fragmentAt);
  const resolved = posix.normalize(posix.join(posix.dirname(normalized), target));
  const prefix = /^(?:.*\/)?site\/src\/content\/docs\//;
  if (!prefix.test(resolved)) return url;

  const route = resolved.replace(prefix, '').replace(/\.mdx?$/, '').replace(/(^|\/)index$/, '');
  return `/Ziggurat/${route}${route ? '/' : ''}${fragment}`;
}

/** @typedef {{ type: string; url?: string; children?: MarkdownNode[] }} MarkdownNode */

export default function remarkRelativeMdLinks() {
  /**
   * @param {MarkdownNode} tree
   * @param {{ path?: string; history?: string[] }} file
   */
  return (tree, file) => {
    /** @param {MarkdownNode} node */
    function visit(node) {
      if (node.type === 'link' && typeof node.url === 'string') {
        node.url = rewriteRelativeMdLink(node.url, file);
      }
      for (const child of node.children ?? []) visit(child);
    }
    visit(tree);
  };
}
