import type { PropsWithChildren, ReactNode } from 'react';
import {
  RefreshControl,
  ScrollView,
  type StyleProp,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useBillyTheme } from '@/hooks/use-billy-theme';
import { spacing } from '@/theme/tokens';

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
  const edges = bottomSafe
    ? (['top', 'left', 'right', 'bottom'] as const)
    : (['top', 'left', 'right'] as const);

  if (!scroll) {
    return (
      <SafeAreaView
        edges={edges}
        style={[styles.safeArea, { backgroundColor: theme.colors.canvas }]}
        testID={testID}>
        <View style={[styles.staticContent, contentStyle]}>{children}</View>
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
        contentContainerStyle={[styles.scrollContent, contentStyle]}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          onRefresh ? (
            <RefreshControl
              colors={[theme.colors.brand]}
              onRefresh={onRefresh}
              refreshing={refreshing}
              tintColor={theme.colors.brand}
            />
          ) : undefined
        }
        showsVerticalScrollIndicator={false}>
        {children}
      </ScrollView>
      {after}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  scrollContent: {
    alignSelf: 'center',
    gap: spacing.xl,
    maxWidth: 720,
    paddingBottom: spacing.huge * 2,
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
});
