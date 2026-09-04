import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppScreen } from '@/components/layout/app-screen';
import { DemoDataBanner } from '@/components/ui/demo-data-banner';
import { ScreenHeader } from '@/components/ui/screen-header';
import { StatePanel } from '@/components/ui/state-panel';
import { useBillyTheme } from '@/hooks/use-billy-theme';
import { radii, spacing, typography } from '@/theme/tokens';

const questions = [
  {
    answer:
      'Open Activity, choose the item, and keep its Billy reference. Pending transactions stay visible while Billy reconciles their final state.',
    question: 'Where can I check a transaction?',
  },
  {
    answer:
      'A pending result is not treated as success or failure. Billy keeps the transaction auditable while confirmation is still uncertain.',
    question: 'What does pending mean?',
  },
  {
    answer:
      'No. Billy support will never ask for your password, verification link, one-time code, or transaction PIN.',
    question: 'Will support ask for my PIN?',
  },
];

export default function SupportScreen() {
  const theme = useBillyTheme();
  const [openQuestion, setOpenQuestion] = useState<number | null>(0);

  return (
    <AppScreen bottomSafe testID="support-screen">
      <ScreenHeader
        subtitle="Guidance without exposing sensitive account information."
        title="Help and support"
      />
      <DemoDataBanner />

      <View
        style={[
          styles.referenceCard,
          { backgroundColor: theme.colors.brandDeep, borderColor: theme.colors.brand },
        ]}>
        <View style={styles.referenceIcon}>
          <Ionicons
            accessible={false}
            color={theme.colors.brand}
            name="help-buoy-outline"
            size={26}
          />
        </View>
        <View style={styles.referenceCopy}>
          <Text style={styles.referenceTitle}>Start with your Billy reference</Text>
          <Text style={styles.referenceBody}>
            Transaction and order references let support investigate without asking for
            passwords or PINs.
          </Text>
        </View>
      </View>

      <View style={styles.faqSection}>
        <Text style={[styles.heading, { color: theme.colors.text }]}>
          Frequently asked questions
        </Text>
        <View
          style={[
            styles.faqCard,
            { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
          ]}>
          {questions.map((item, index) => {
            const open = openQuestion === index;
            return (
              <View key={item.question}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded: open }}
                  onPress={() => setOpenQuestion(open ? null : index)}
                  style={({ pressed }) => [
                    styles.question,
                    {
                      borderBottomColor: theme.colors.border,
                      opacity: pressed ? 0.65 : 1,
                    },
                  ]}>
                  <Text style={[styles.questionText, { color: theme.colors.text }]}>
                    {item.question}
                  </Text>
                  <Ionicons
                    accessible={false}
                    color={theme.colors.textMuted}
                    name={open ? 'chevron-up' : 'chevron-down'}
                    size={19}
                  />
                </Pressable>
                {open ? (
                  <Text
                    accessibilityLiveRegion="polite"
                    style={[styles.answer, { color: theme.colors.textMuted }]}>
                    {item.answer}
                  </Text>
                ) : null}
              </View>
            );
          })}
        </View>
      </View>

      <StatePanel
        compact
        icon="chatbox-ellipses-outline"
        message="A support-request form will be enabled after the official support channel and response policy are approved. Billy does not display a fake chat button."
        title="Need more help?"
        tone="brand"
      />
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  answer: {
    fontFamily: typography.family,
    fontSize: 13,
    lineHeight: 20,
    padding: spacing.lg,
    paddingTop: 0,
  },
  faqCard: {
    borderRadius: radii.xl,
    borderWidth: 1,
    overflow: 'hidden',
  },
  faqSection: {
    gap: spacing.md,
  },
  heading: {
    fontFamily: typography.familyRounded,
    fontSize: 17,
    fontWeight: '800',
  },
  question: {
    alignItems: 'center',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    minHeight: 62,
    paddingHorizontal: spacing.lg,
  },
  questionText: {
    flex: 1,
    fontFamily: typography.familyRounded,
    fontSize: 13,
    fontWeight: '700',
  },
  referenceBody: {
    color: 'rgba(255,255,255,0.76)',
    fontFamily: typography.family,
    fontSize: 12,
    lineHeight: 18,
  },
  referenceCard: {
    alignItems: 'center',
    borderRadius: radii.xl,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.lg,
  },
  referenceCopy: {
    flex: 1,
    gap: 4,
  },
  referenceIcon: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: radii.pill,
    height: 50,
    justifyContent: 'center',
    width: 50,
  },
  referenceTitle: {
    color: '#FFFFFF',
    fontFamily: typography.familyRounded,
    fontSize: 15,
    fontWeight: '800',
  },
});
