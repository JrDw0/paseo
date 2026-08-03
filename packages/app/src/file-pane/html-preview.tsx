import { useMemo } from "react";
import { StyleSheet } from "react-native-unistyles";
import { WebView } from "react-native-webview";

export interface HtmlPreviewProps {
  html: string;
  testID?: string;
}

const ORIGIN_WHITELIST = ["*"];

export function HtmlPreview({ html, testID }: HtmlPreviewProps) {
  // WebView reloads when `source` changes identity, so it must be stable
  // across renders for the same html string.
  const source = useMemo(() => ({ html }), [html]);

  return (
    <WebView
      testID={testID}
      source={source}
      originWhitelist={ORIGIN_WHITELIST}
      scrollEnabled
      nestedScrollEnabled
      setSupportMultipleWindows={false}
      style={styles.webview}
    />
  );
}

const styles = StyleSheet.create({
  webview: {
    flex: 1,
  },
});
