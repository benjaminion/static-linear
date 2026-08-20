import { marked } from "marked";
import sanitizeHtml from "sanitize-html";

const PRIVATE_LINEAR_ASSET = /https:\/\/(?:uploads|public)\.linear\.app\/[\w./?%=&+-]+/gi;
const PRIVATE_LINEAR_IMAGE = /!\[[^\]]*\]\(https:\/\/(?:uploads|public)\.linear\.app\/[^)]+\)/gi;
const UNSAFE_PROTOCOL = /\b(?:javascript|vbscript|data):/gi;
const EMAIL_ADDRESS = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const HTML_LINK = /<a\b[^>]*>([\s\S]*?)<\/a>/gi;

interface MarkdownOptions {
  stripStarredLinks?: boolean;
  rewriteHref?: (href: string) => string;
}

export function renderPublicMarkdown(
  markdown: string | null | undefined,
  options: MarkdownOptions = {},
): string {
  if (!markdown) return "";

  const withoutPrivateAssets = markdown
    .replace(PRIVATE_LINEAR_IMAGE, "[Attachment available in Linear](#linear-private-asset)")
    .replace(PRIVATE_LINEAR_ASSET, "#linear-private-asset")
    .replace(UNSAFE_PROTOCOL, "")
    .replace(EMAIL_ADDRESS, "[redacted email]");

  const raw = marked.parse(withoutPrivateAssets, {
    async: false,
    gfm: true,
    breaks: false,
  });

  const sanitized = sanitizeHtml(raw, {
    allowedTags: [
      "p", "br", "strong", "em", "del", "code", "pre", "blockquote",
      "ul", "ol", "li", "h1", "h2", "h3", "h4", "h5", "h6",
      "a", "span", "table", "thead", "tbody", "tr", "th", "td", "hr",
    ],
    allowedAttributes: {
      a: ["href", "title", "target", "rel", "class", "data-private-asset"],
      span: ["class"],
      code: ["class"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    transformTags: {
      a: (_tagName, attribs): sanitizeHtml.Tag => {
        if (attribs.href === "#linear-private-asset") {
          return {
            tagName: "span",
            attribs: {
              class: "private-asset",
            },
          };
        }
        const href = options.rewriteHref?.(attribs.href) ?? attribs.href;
        if (href.startsWith("/") || href.startsWith("#")) {
          const localAttributes: sanitizeHtml.Attributes = { ...attribs, href };
          delete localAttributes.target;
          delete localAttributes.rel;
          return {
            tagName: "a",
            attribs: localAttributes,
          };
        }
        const hardenedAttributes: sanitizeHtml.Attributes = {
          ...attribs,
          href,
          target: "_blank",
          rel: "noopener noreferrer",
        };
        return {
          tagName: "a",
          attribs: hardenedAttributes,
        };
      },
    },
    exclusiveFilter: (frame) => frame.tag === "img",
  }).replace(/(<span class="private-asset">).*?(<\/span>)/g, "$1Attachment available in Linear$2");

  return options.stripStarredLinks === false
    ? sanitized
    : stripLinksMarkedForPlainText(sanitized);
}

function stripLinksMarkedForPlainText(html: string): string {
  return html.replace(HTML_LINK, (anchor, innerHtml: string) => {
    const visibleText = innerHtml
      .replace(/<[^>]*>/g, "")
      .replace(/(?:&#42;|&#x2a;|&ast;)/gi, "*")
      .trimEnd();

    if (!visibleText.endsWith("*")) return anchor;

    const trailingMarkup = "((?:\\s|<\\/[^>]+>)*)$";
    const literalStar = new RegExp(`\\*${trailingMarkup}`);
    const encodedStar = new RegExp(`(?:&#42;|&#x2a;|&ast;)${trailingMarkup}`, "i");
    return innerHtml.replace(literalStar, "$1").replace(encodedStar, "$1");
  });
}
