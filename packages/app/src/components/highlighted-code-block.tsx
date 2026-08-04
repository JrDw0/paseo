import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { MarkdownTextSpan } from "@/components/markdown-text";
import * as Clipboard from "expo-clipboard";
import { Check, Copy } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import type { HighlightToken } from "@getpaseo/highlight";
import { isNative, isWeb } from "@/constants/platform";
import { useIsCompactFormFactor } from "@/constants/layout";
import { syntaxTokenStyleFor } from "@/styles/syntax-token-styles";
import { CODE_SURFACE_DATASET } from "@/styles/code-surface";
import { highlightToKeyedLines, type KeyedLine } from "@/utils/highlight-cache";
import {
  markdownCopyCodeBlockDataSet,
  markdownCopyDataSet,
} from "@/assistant-selection-copy/markup";

interface HighlightedCodeBlockProps {
  code: string;
  language: string | null | undefined;
  inheritedStyles: TextStyle;
  textStyle: TextStyle;
}

// Fence info strings ("```ts", "```typescript", "```ts {1,3}") map to the
// extension-based parser table in @getpaseo/highlight. Aliases here only
// cover names that don't already match an extension key in parsers.ts.
const LANGUAGE_ALIASES: Record<string, string> = {
  typescript: "ts",
  javascript: "js",
  python: "py",
  rust: "rs",
  golang: "go",
  "c++": "cpp",
  csharp: "cs",
  "c#": "cs",
  objc: "m",
  "objective-c": "m",
  markdown: "md",
  elixir: "ex",
};

function fenceLanguageToExtension(info: string | null | undefined): string | null {
  if (!info) return null;
  const first = info.trim().split(/\s+/)[0]?.toLowerCase();
  if (!first) return null;
  const normalized = first.replace(/^\./, "");
  return LANGUAGE_ALIASES[normalized] ?? normalized;
}

function stripTerminalFenceNewline(code: string): string {
  return code.endsWith("\n") ? code.slice(0, -1) : code;
}

// Longer than the 48ms stream flush cadence, short enough to feel instant once
// output pauses.
const HIGHLIGHT_SETTLE_DELAY_MS = 250;
// A stream that appends continuously without ever pausing long enough for the
// settle timer (250ms) to fire would render plain text for the whole stream.
// Once un-settled growth has run this long, force fresh highlighting for one
// beat so the output isn't stuck un-highlighted; the normal debounce resumes
// on the next pause.
const HIGHLIGHT_FORCE_INTERVAL_MS = 1000;

export const HighlightedCodeBlock = React.memo(function HighlightedCodeBlock({
  code,
  language,
  inheritedStyles,
  textStyle,
}: HighlightedCodeBlockProps) {
  // Box styles (bg / padding / border / radius / margin) go on the wrapper View
  // so the absolute copy button positions relative to the visible code area,
  // not to a parent that includes the Text's own marginVertical.
  const { containerStyle, innerTextStyle } = useMemo(
    () => splitFenceStyle(inheritedStyles, textStyle),
    [inheritedStyles, textStyle],
  );
  const renderedCode = useMemo(() => stripTerminalFenceNewline(code), [code]);
  const copyDataSet = useMemo(
    () => ({ ...CODE_SURFACE_DATASET, ...markdownCopyCodeBlockDataSet(language) }),
    [language],
  );

  // Streaming a code fence re-renders this component every flush (~48ms) with a
  // growing `code` string; highlighting parses the full text via Lezer each time
  // (the cache key is the whole string). Defer highlighting until updates pause:
  // while `code` keeps growing, render the current text plainly; once it settles
  // for HIGHLIGHT_SETTLE_DELAY_MS (stream end or a model pause), one full highlight
  // runs. Static/history blocks settle on mount, so they highlight immediately.
  const [settledCode, setSettledCode] = useState(renderedCode);
  const previousRenderedRef = useRef(renderedCode);
  useEffect(() => {
    previousRenderedRef.current = renderedCode;
  }, [renderedCode]);
  useEffect(() => {
    if (settledCode === renderedCode) {
      return;
    }
    const timer = setTimeout(() => setSettledCode(renderedCode), HIGHLIGHT_SETTLE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [renderedCode, settledCode]);
  // Only streaming appends defer highlighting. A wholesale replacement (a diff
  // placeholder resolving into real content, a shorter re-generated block) is
  // already complete — highlight it now instead of flashing plain for 250ms.
  const isAppendGrowth = renderedCode.startsWith(previousRenderedRef.current);

  // Track the wall-clock time the last highlight completed. Sustained append
  // growth keeps the settle timer from ever firing, so without this the block
  // stays plain until the stream pauses. When the reject is due to un-settled
  // growth older than HIGHLIGHT_FORCE_INTERVAL_MS, drop the reject for one beat
  // so a fresh highlight (and therefore a refreshed lastHighlightAt) runs.
  const lastHighlightAtRef = useRef<number>(0);
  const forceHighlightForSustainedStream =
    isAppendGrowth &&
    settledCode !== renderedCode &&
    Date.now() - lastHighlightAtRef.current > HIGHLIGHT_FORCE_INTERVAL_MS;

  // Wholesale replacement that is also a strict prefix-extension is misclassified
  // as append, deferring highlight 250ms. Rare; acceptable; see review 2026-08-05.
  const highlightPending =
    settledCode !== renderedCode && isAppendGrowth && !forceHighlightForSustainedStream;

  const keyedLines = useMemo<KeyedLine[] | null>(() => {
    if (highlightPending) {
      return null;
    }
    return highlightToKeyedLines(renderedCode, fenceLanguageToExtension(language));
  }, [renderedCode, language, highlightPending]);
  // Refresh lastHighlightAt whenever a real highlight lands, so a sustained
  // stream gets a re-highlight about once per HIGHLIGHT_FORCE_INTERVAL_MS
  // instead of staying plain until the stream finally pauses.
  useEffect(() => {
    if (keyedLines) lastHighlightAtRef.current = Date.now();
  }, [keyedLines]);

  const isCompact = useIsCompactFormFactor();
  const [isHovered, setIsHovered] = useState(false);
  const handlePointerEnter = useCallback(() => setIsHovered(true), []);
  const handlePointerLeave = useCallback(() => setIsHovered(false), []);
  const controlsVisible = isHovered || isNative || isCompact;
  const getCode = useCallback(() => code, [code]);

  return (
    <View
      style={containerStyle}
      dataSet={copyDataSet}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
    >
      {keyedLines ? (
        <MarkdownTextSpan style={innerTextStyle} copyTag="code">
          {renderCodeSegments(keyedLines)}
        </MarkdownTextSpan>
      ) : (
        <MarkdownTextSpan style={innerTextStyle} copyTag="code">
          {renderedCode}
        </MarkdownTextSpan>
      )}
      <CopyButton getCode={getCode} visible={controlsVisible} />
    </View>
  );
});

function renderCodeSegments(keyedLines: KeyedLine[]): React.ReactNode[] {
  const segments: React.ReactNode[] = [];
  for (let lineIndex = 0; lineIndex < keyedLines.length; lineIndex += 1) {
    const line = keyedLines[lineIndex];
    if (lineIndex > 0) {
      segments.push(<CodeTextSpan key={`${line.key}-newline`} text={"\n"} />);
    }
    for (const { key, token } of line.tokens) {
      segments.push(<TokenSpan key={`${line.key}-${key}`} token={token} />);
    }
  }
  return segments;
}

interface TokenSpanProps {
  token: HighlightToken;
}

const TokenSpan = React.memo(function TokenSpan({ token }: TokenSpanProps) {
  return (
    <MarkdownTextSpan style={token.style ? syntaxTokenStyleFor(token.style) : undefined}>
      {token.text}
    </MarkdownTextSpan>
  );
});

interface CodeTextSpanProps {
  text: string;
}

const CodeTextSpan = React.memo(function CodeTextSpan({ text }: CodeTextSpanProps) {
  return <MarkdownTextSpan>{text}</MarkdownTextSpan>;
});

interface SplitStyles {
  containerStyle: StyleProp<ViewStyle>;
  innerTextStyle: StyleProp<TextStyle>;
}

const CONTAINER_BASE: ViewStyle = { position: "relative" };
const WEB_SELECTABLE: TextStyle = isWeb ? ({ userSelect: "text" } as TextStyle) : {};

function splitFenceStyle(inheritedStyles: TextStyle, textStyle: TextStyle): SplitStyles {
  const { fontFamily, fontSize, color, ...box } = textStyle;
  const textOnly: TextStyle = { ...WEB_SELECTABLE };
  if (fontFamily !== undefined) textOnly.fontFamily = fontFamily;
  if (fontSize !== undefined) textOnly.fontSize = fontSize;
  if (fontSize !== undefined) textOnly.lineHeight = Math.round(fontSize * 1.45);
  if (color !== undefined) textOnly.color = color;
  return {
    containerStyle: [box as ViewStyle, CONTAINER_BASE],
    innerTextStyle: [inheritedStyles, textOnly],
  };
}

interface CopyButtonProps {
  getCode: () => string;
  visible: boolean;
}

const COPIED_RESET_MS = 1500;

const CopyButton = React.memo(function CopyButton({ getCode, visible }: CopyButtonProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const resetRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (resetRef.current) clearTimeout(resetRef.current);
    },
    [],
  );

  const handlePress = useCallback(async () => {
    const content = getCode();
    if (!content) return;
    await Clipboard.setStringAsync(content);
    setCopied(true);
    if (resetRef.current) clearTimeout(resetRef.current);
    resetRef.current = setTimeout(() => {
      setCopied(false);
      resetRef.current = null;
    }, COPIED_RESET_MS);
  }, [getCode]);

  const visibilityStyle = visible
    ? copyButtonStyles.containerVisible
    : copyButtonStyles.containerHidden;
  const wrapperStyle = useMemo(
    () => [copyButtonStyles.container, visibilityStyle],
    [visibilityStyle],
  );

  return (
    <Pressable
      onPress={handlePress}
      style={wrapperStyle}
      pointerEvents={visible ? "auto" : "none"}
      accessibilityRole="button"
      accessibilityLabel={copied ? t("message.actions.copied") : t("message.actions.copyCode")}
      hitSlop={8}
      dataSet={markdownCopyDataSet.ignore}
    >
      {({ hovered }) => {
        const iconColor = hovered
          ? copyButtonStyles.iconHoveredColor.color
          : copyButtonStyles.iconColor.color;
        return copied ? (
          <Check size={14} color={iconColor} />
        ) : (
          <Copy size={14} color={iconColor} />
        );
      }}
    </Pressable>
  );
});

const copyButtonStyles = StyleSheet.create((theme) => ({
  container: {
    position: "absolute",
    top: theme.spacing[2],
    right: theme.spacing[2],
    padding: theme.spacing[1],
  },
  containerVisible: {
    opacity: 1,
  },
  containerHidden: {
    opacity: 0,
  },
  iconColor: {
    color: theme.colors.foregroundMuted,
  },
  iconHoveredColor: {
    color: theme.colors.foreground,
  },
}));
