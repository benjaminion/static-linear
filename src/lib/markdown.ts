import { marked } from "marked";
import sanitizeHtml from "sanitize-html";

const PRIVATE_LINEAR_ASSET = /https:\/\/(?:uploads|public)\.linear\.app\/[\w./?%=&+-]+/gi;
const PRIVATE_LINEAR_IMAGE = /!\[[^\]]*\]\(https:\/\/(?:uploads|public)\.linear\.app\/[^)]+\)/gi;
const UNSAFE_PROTOCOL = /\b(?:javascript|vbscript|data):/gi;
const EMAIL_ADDRESS = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;

export function renderPublicMarkdown(markdown: string | null | undefined): string {
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

  return sanitizeHtml(raw, {
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
        const hardenedAttributes: sanitizeHtml.Attributes = {
          ...attribs,
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
}
