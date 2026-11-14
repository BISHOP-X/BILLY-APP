import { type PropsWithChildren, type ReactNode, type Ref, useContext, useEffect, useRef, useState } from 'react';
import { QueryClientContext } from '@tanstack/react-query';
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
  onRefresh?: () => void | Promise<unknown>;
  refreshing?: boolean;
  scroll?: boolean;
  scrollRef?: Ref<ScrollView>;
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
  scrollRef,
  testID,
}: AppScreenProps) {
  const theme = useBillyTheme();
  const queryClient = useContext(QueryClientContext);
  const localScrollRef = useRef<ScrollView | null>(null);
  const [localRefreshing, setLocalRefreshing] = useState(false);
  const refreshFlight = useRef(false);
  const isRefreshing = refreshing || localRefreshing;
  const { fontScale, width } = useWindowDimensions();
  const [webPullDistance, setWebPullDistance] = useState(0);
  const webPullDistanceRef = useRef(0);
  const webPullStartYRef = useRef<number | null>(null);
  const webPullStartXRef = useRef(0);
  const scrollOffsetYRef = useRef(0);
  const desktopWeb =
    Platform.OS === 'web' && usesDesktopWebLayout(width, fontScale);
  const webRefreshEnabled =
    Platform.OS === 'web' && !desktopWeb && Boolean(onRefresh || queryClient);
  const contentFrame = {
    maxWidth: desktopWeb ? WEB_CONTENT_MAX_WIDTH : 720,
  };
  const edges = bottomSafe
    ? (['top', 'left', 'right', 'bottom'] as const)
    : (['top', 'left', 'right'] as const);

  function beginWebPull(event: GestureResponderEvent) {
    if (!webRefreshEnabled || isRefreshing || scrollOffsetYRef.current > 1) return;
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
    if (shouldRefresh && !isRefreshing) void refreshPage();
  }

  async function refreshPage() {
    if (refreshFlight.current) return;
    refreshFlight.current = true; setLocalRefreshing(true);
    try {
      if (onRefresh) await onRefresh();
      else await queryClient?.invalidateQueries({ refetchType: 'active' });
    } catch { /* Each query retains its error/retry UI; preserve the current form. */ }
    finally { refreshFlight.current = false; setLocalRefreshing(false); }
  }
  function cancelWebPull() {
    webPullStartYRef.current = null; webPullDistanceRef.current = 0; setWebPullDistance(0);
  }
  // Browser touch events report coordinates on touches[], not pageY on the
  // event. A non-passive listener is necessary to retain a deliberate pull at
  // scrollTop=0 instead of losing it to the browser's nested scrolling gesture.
  useEffect(() => {
    if (!webRefreshEnabled || typeof document === 'undefined') return;
    const node = localScrollRef.current?.getScrollableNode() as HTMLElement | undefined;
    if (!node?.addEventListener) return;
    const start = (event: TouchEvent) => {
      if (event.touches.length !== 1 || isRefreshing || node.scrollTop > 1 || (event.target as HTMLElement)?.closest('input,textarea,[role="slider"]')) return;
      webPullStartXRef.current = event.touches[0].pageX; webPullStartYRef.current = event.touches[0].pageY;
    };
    const move = (event: TouchEvent) => {
      if (webPullStartYRef.current === null || event.touches.length !== 1) return;
      const touch = event.touches[0], dy = touch.pageY - webPullStartYRef.current;
      if (node.scrollTop > 1 || Math.abs(touch.pageX - webPullStartXRef.current) > Math.max(12, dy)) { cancelWebPull(); return; }
      if (dy <= 0) { cancelWebPull(); return; }
      if (event.cancelable) event.preventDefault();
      const distance = Math.min(78, dy * 0.55);
      webPullDistanceRef.current = distance; setWebPullDistance(distance);
    };
    node.addEventListener('touchstart', start, { passive: true });
    node.addEventListener('touchmove', move, { passive: false });
    node.addEventListener('touchend', finishWebPull);
    node.addEventListener('touchcancel', cancelWebPull);
    return () => {
      node.removeEventListener('touchstart', start); node.removeEventListener('touchmove', move);
      node.removeEventListener('touchend', finishWebPull); node.removeEventListener('touchcancel', cancelWebPull);
    };
  });

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
        ref={(node) => { localScrollRef.current = node; if (typeof scrollRef === 'function') scrollRef(node); else if (scrollRef) scrollRef.current = node; }}
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
        onTouchCancel={webRefreshEnabled && typeof document === 'undefined' ? cancelWebPull : undefined}
        onTouchEnd={webRefreshEnabled && typeof document === 'undefined' ? finishWebPull : undefined}
        onTouchMove={webRefreshEnabled && typeof document === 'undefined' ? continueWebPull : undefined}
        onTouchStart={webRefreshEnabled && typeof document === 'undefined' ? beginWebPull : undefined}
        refreshControl={
          Platform.OS !== 'web' && (onRefresh || queryClient) ? (
            <RefreshControl
              colors={[theme.colors.brand]}
              onRefresh={() => void refreshPage()}
              refreshing={isRefreshing}
              tintColor={theme.colors.brand}
            />
          ) : undefined
        }
        showsVerticalScrollIndicator={false}
        testID={testID ? `${testID}-scroll` : undefined}>
        {children}
      </ScrollView>
      {webRefreshEnabled && (webPullDistance > 0 || isRefreshing) ? (
        <View
          accessibilityLiveRegion="polite"
          pointerEvents="none"
          style={[
            styles.webRefreshPill,
            {
              backgroundColor: theme.colors.surface,
              borderColor: theme.colors.border,
              opacity: isRefreshing ? 1 : Math.min(1, webPullDistance / 36),
              transform: [
                {
                  translateY: isRefreshing
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
