import { useCallback, useMemo, type ComponentProps, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import {
  Pressable,
  Text,
  View,
  type ListRenderItemInfo,
  type PressableStateCallbackType,
} from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import Animated from "react-native-reanimated";
import {
  BottomSheetBackdrop,
  BottomSheetFlatList,
  type BottomSheetBackgroundProps,
} from "@gorhom/bottom-sheet";
import { Image as ImageIcon, X } from "lucide-react-native";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import {
  IsolatedBottomSheetModal,
  useIsolatedBottomSheetVisibility,
} from "@/components/ui/isolated-bottom-sheet-modal";
import type { Theme } from "@/styles/theme";

const ThemedX = withUnistyles(X);
const ThemedImageIcon = withUnistyles(ImageIcon);
const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

/**
 * A row of user messages the viewport can jump to. The parent formats the
 * preview and the relative timestamp so the sheet stays presentational. `seq`
 * is the timeline row's global sequence, used to back-fill rows not yet loaded.
 */
export interface MessageJumpEntry {
  id: string;
  seq: number;
  preview: string;
  timestampLabel: string;
  hasImages: boolean;
}

interface MessageJumpSheetProps {
  visible: boolean;
  entries: MessageJumpEntry[];
  loading?: boolean;
  onSelect: (entry: MessageJumpEntry) => void;
  onClose: () => void;
}

function keyExtractor(entry: MessageJumpEntry): string {
  return entry.id;
}

function MessageJumpSheetBackground({ style }: BottomSheetBackgroundProps) {
  return <Animated.View pointerEvents="none" style={[style, styles.background]} />;
}

function MessageJumpRow({
  entry,
  onSelect,
}: {
  entry: MessageJumpEntry;
  onSelect: (entry: MessageJumpEntry) => void;
}) {
  const handlePress = useCallback(() => onSelect(entry), [entry, onSelect]);
  const rowStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => [styles.row, pressed && styles.rowPressed],
    [],
  );
  return (
    <Pressable
      onPress={handlePress}
      style={rowStyle}
      accessibilityRole="button"
      testID={`message-jump-row-${entry.id}`}
    >
      <Text style={styles.rowText} numberOfLines={2}>
        {entry.preview}
      </Text>
      <View style={styles.rowMeta}>
        {entry.hasImages ? <ThemedImageIcon size={13} uniProps={mutedColorMapping} /> : null}
        <Text style={styles.rowTime}>{entry.timestampLabel}</Text>
      </View>
    </Pressable>
  );
}

/**
 * Bottom sheet listing the loaded user messages of the current conversation,
 * used as the mobile-friendly take on ChatGPT's message minimap: tap a row to
 * scroll the stream to that message.
 */
export function MessageJumpSheet({
  visible,
  entries,
  loading,
  onSelect,
  onClose,
}: MessageJumpSheetProps) {
  const { t } = useTranslation();
  const snapPoints = useMemo(() => ["40%", "70%"], []);

  const { sheetRef, handleSheetChange, handleSheetDismiss } = useIsolatedBottomSheetVisibility({
    visible,
    onClose,
  });

  const renderBackdrop = useCallback(
    (props: ComponentProps<typeof BottomSheetBackdrop>) => (
      <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} opacity={0.5} />
    ),
    [],
  );

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<MessageJumpEntry>): ReactElement => (
      <MessageJumpRow entry={item} onSelect={onSelect} />
    ),
    [onSelect],
  );

  const header = useMemo(
    () => (
      <View style={styles.header}>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {t("agentStream.messageJump.title")}
        </Text>
        <Pressable
          onPress={onClose}
          style={styles.closeButton}
          accessibilityRole="button"
          accessibilityLabel={t("agentStream.messageJump.close")}
          hitSlop={8}
        >
          <ThemedX size={18} uniProps={mutedColorMapping} />
        </Pressable>
      </View>
    ),
    [onClose, t],
  );

  const emptyState = useMemo(
    () => (
      <View style={styles.empty}>
        {loading ? (
          <ThemedLoadingSpinner size="small" uniProps={mutedColorMapping} />
        ) : (
          <Text style={styles.emptyText}>{t("agentStream.messageJump.empty")}</Text>
        )}
      </View>
    ),
    [loading, t],
  );

  return (
    <IsolatedBottomSheetModal
      ref={sheetRef}
      snapPoints={snapPoints}
      index={0}
      enableDynamicSizing={false}
      onChange={handleSheetChange}
      onDismiss={handleSheetDismiss}
      backdropComponent={renderBackdrop}
      enablePanDownToClose
      backgroundComponent={MessageJumpSheetBackground}
      handleIndicatorStyle={styles.handleIndicator}
    >
      <BottomSheetFlatList
        data={entries}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={header}
        stickyHeaderIndices={[0]}
        ListEmptyComponent={emptyState}
      />
    </IsolatedBottomSheetModal>
  );
}

const styles = StyleSheet.create((theme) => ({
  background: {
    backgroundColor: theme.colors.surface2,
    borderRadius: 16,
  },
  handleIndicator: {
    backgroundColor: theme.colors.palette.zinc[600],
  },
  listContent: {
    paddingBottom: theme.spacing[6],
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: theme.spacing[4],
    paddingTop: theme.spacing[2],
    paddingBottom: theme.spacing[2],
    backgroundColor: theme.colors.surface2,
  },
  headerTitle: {
    flex: 1,
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foreground,
  },
  closeButton: {
    padding: theme.spacing[2],
  },
  row: {
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    gap: theme.spacing[1],
  },
  rowPressed: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  rowText: {
    fontSize: theme.fontSize.base,
    color: theme.colors.foreground,
  },
  rowMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  rowTime: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  empty: {
    alignItems: "center",
    paddingVertical: theme.spacing[12],
  },
  emptyText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
}));
