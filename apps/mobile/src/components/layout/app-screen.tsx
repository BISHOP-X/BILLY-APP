import { type PropsWithChildren, type ReactNode, useRef, useState } from 'react';
import {
  ActivityIndicator,
  type GestureResponderEvent,
  Platform,
  RefreshControl,
  ScrollView,
  type StyleProp,
  StyleSheet,
  useWindowDimensions,
  View,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useBillyTheme } from '@/hooks/use-billy-theme';
import {
  usesDesktopWebLayout,
  WEB_CONTENT_MAX_WIDTH,
} from '@/constants/web-layout';
import { layout, spacing } from '@/theme/tokens';

type AppScreenProps = PropsWithChildren<{
  after?: ReactNode;
  bottomSafe?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  onRefresh?: () => void;
  refreshing?: boolean;
  scroll?: boolean;
  testID?: string;
}>;

export function AppScreen({
  after,
  bottomSafe = false,
  children,
  contentStyle,
  onRefresh,
  refreshing = false,
  scroll = true,
  testID,
}: AppScreenProps) {
  const theme = useBillyTheme();
  const { fontScale, width } = useWindowDimensions();
  const [webPullDistance, setWebPullDistance] = useState(0);
  const webPullDistanceRef = useRef(0);
  const webPullStartYRef = useRef<number | null>(null);
  const scrollOffsetYRef = useRef(0);
  const desktopWeb =
    Platform.OS === 'web' && usesDesktopWebLayout(width, fontScale);
  const webRefreshEnabled =
    Platform.OS === 'web' && !desktopWeb && Boolean(onRefresh);
  const contentFrame = {
    maxWidth: desktopWeb ? WEB_CONTENT_MAX_WIDTH : 720,
  };
  const edges = bottomSafe
    ? (['top', 'left', 'right', 'bottom'] as const)
    : (['top', 'left', 'right'] as const);

  function beginWebPull(event: GestureResponderEvent) {
    if (!webRefreshEnabled || refreshing || scrollOffsetYRef.current > 1) return;
    webPullStartYRef.current = event.nativeEvent.pageY;
  }

  function continueWebPull(event: GestureResponderEvent) {
    if (webPullStartYRef.current === null) return;
    const distance = Math.max(
      0,
      Math.min(78, (event.nativeEvent.pageY - webPullStartYRef.current) * 0.42),
    );
    webPullDistanceRef.current = distance;
    setWebPullDistance(distance);
  }

  function finishWebPull() {
    const shouldRefresh = webPullDistanceRef.current >= 48;
    webPullStartYRef.current = null;
    webPullDistanceRef.current = 0;
    setWebPullDistance(0);
    if (shouldRefresh && !refreshing) onRefresh?.();
  }

  if (!scroll) {
    return (
      <SafeAreaView
        edges={edges}
        style={[styles.safeArea, { backgroundColor: theme.colors.canvas }]}
        testID={testID}>
        <View style={[styles.staticContent, contentFrame, contentStyle]}>
          {children}
        </View>
        {after}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      edges={edges}
      style={[styles.safeArea, { backgroundColor: theme.colors.canvas }]}
      testID={testID}>
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          contentFrame,
          desktopWeb && styles.desktopScrollContent,
          contentStyle,
        ]}
        keyboardShouldPersistTaps="handled"
        onScroll={(event) => {
          scrollOffsetYRef.current = event.nativeEvent.contentOffset.y;
        }}
        scrollEventThrottle={16}
        onTouchCancel={webRefreshEnabled ? finishWebPull : undefined}
        onTouchEnd={webRefreshEnabled ? finishWebPull : undefined}
        onTouchMove={webRefreshEnabled ? continueWebPull : undefined}
        onTouchStart={webRefreshEnabled ? beginWebPull : undefined}
        refreshControl={
          Platform.OS !== 'web' && onRefresh ? (
            <RefreshControl
              colors={[theme.colors.brand]}
              onRefresh={onRefresh}
              refreshing={refreshing}
              tintColor={theme.colors.brand}
            />
          ) : undefined
        }
        showsVerticalScrollIndicator={false}
        testID={testID ? `${testID}-scroll` : undefined}>
        {children}
      </ScrollView>
      {webRefreshEnabled && (webPullDistance > 0 || refreshing) ? (
        <View
          accessibilityLiveRegion="polite"
          pointerEvents="none"
          style={[
            styles.webRefreshPill,
            {
              backgroundColor: theme.colors.surface,
              borderColor: theme.colors.border,
              opacity: refreshing ? 1 : Math.min(1, webPullDistance / 36),
              transform: [
                {
                  translateY: refreshing
                    ? 0
                    : Math.min(18, webPullDistance * 0.24),
                },
              ],
            },
          ]}>
          <ActivityIndicator color={theme.colors.brand} size="small" />
        </View>
      ) : null}
      {after}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  desktopScrollContent: {
    paddingBottom: spacing.xxxl,
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.lg,
  },
  scrollContent: {
    alignSelf: 'center',
    gap: spacing.xl,
    maxWidth: 720,
    paddingBottom: layout.bottomTabDockReserve,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    width: '100%',
  },
  staticContent: {
    alignSelf: 'center',
    flex: 1,
    maxWidth: 720,
    width: '100%',
  },
  webRefreshPill: {
    alignItems: 'center',
    borderRadius: 22,
    borderWidth: 1,
    height: 44,
    justifyContent: 'center',
    left: '50%',
    marginLeft: -22,
    position: 'absolute',
    top: spacing.sm,
    width: 44,
    zIndex: 20,
  },
});
