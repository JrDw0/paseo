import { describe, expect, it } from "vitest";
import { isRenderedHtmlFile, isRenderedMarkdownFile } from "@/components/file-pane-render-mode";

describe("isRenderedHtmlFile", () => {
  it("detects .html and .htm files", () => {
    expect(isRenderedHtmlFile("index.html")).toBe(true);
    expect(isRenderedHtmlFile("docs/guide.HTM")).toBe(true);
    expect(isRenderedHtmlFile("report.html")).toBe(true);
  });

  it("does not treat markdown or other text files as html", () => {
    expect(isRenderedHtmlFile("README.md")).toBe(false);
    expect(isRenderedHtmlFile("src/index.ts")).toBe(false);
    expect(isRenderedHtmlFile("page.html.txt")).toBe(false);
  });
});

describe("isRenderedMarkdownFile", () => {
  it("detects .md files", () => {
    expect(isRenderedMarkdownFile("README.md")).toBe(true);
    expect(isRenderedMarkdownFile("docs/guide.MD")).toBe(true);
  });

  it("detects .markdown files", () => {
    expect(isRenderedMarkdownFile("notes.markdown")).toBe(true);
    expect(isRenderedMarkdownFile("docs/CHANGELOG.MARKDOWN")).toBe(true);
  });

  it("does not treat .mdx files as rendered markdown", () => {
    expect(isRenderedMarkdownFile("page.mdx")).toBe(false);
  });

  it("does not treat other text files as rendered markdown", () => {
    expect(isRenderedMarkdownFile("src/index.ts")).toBe(false);
    expect(isRenderedMarkdownFile("README.md.txt")).toBe(false);
  });
});
