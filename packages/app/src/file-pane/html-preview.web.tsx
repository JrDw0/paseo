import { StyleSheet } from "react-native-unistyles";
import { View } from "react-native";

export interface HtmlPreviewProps {
  html: string;
  testID?: string;
}

// Sandboxed without allow-same-origin so scripts run in an opaque origin: they
// execute normally but can't read app origin storage or make credentialed
// requests against it.
export function HtmlPreview({ html, testID }: HtmlPreviewProps) {
  return (
    <View style={styles.container} testID={testID}>
      <iframe sandbox="allow-scripts" srcDoc={html} title="HTML preview" style={iframeStyle} />
    </View>
  );
}

const iframeStyle = {
  display: "block",
  border: "none",
  width: "100%",
  height: "100%",
  // Bare HTML has no background of its own; the app chrome is dark, so paint a
  // light surface or default-on-black text disappears.
  backgroundColor: "#ffffff",
} as const;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    minHeight: 0,
  },
});
