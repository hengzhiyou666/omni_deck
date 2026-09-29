import { Ionicons } from '@expo/vector-icons';
import React, { useCallback } from 'react';
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { theme } from '../constants/theme';
import { useTranslation, type TranslationKey } from '../lib/i18n';
import { useRosStore } from '../stores/useRosStore';
import { requestPosture, usePostureStore, type PostureCommand } from '../lib/posture-actions';
export { POSTURE_COMMAND_TOPIC, POSTURE_STATUS_TOPIC, POSTURE_MESSAGE_TYPE,
  POSTURE_COMMANDS, buildPostureCommand, parsePostureStatus } from '../lib/posture-actions';
export type { PostureCommand } from '../lib/posture-actions';

export function PostureControl({ compact = false }: { compact?: boolean }) {
  const status = useRosStore((state) => state.connection.status);
  const transport = useRosStore((state) => state.transport);
  const url = useRosStore((state) => state.connection.url);
  const { t } = useTranslation();
  const pending = usePostureStore((state) => state.pending);
  const sendCommand = useCallback((command: PostureCommand) => {
    void requestPosture(command).catch((error) => {
      Alert.alert(t('posture.failedTitle'), error instanceof Error ? error.message : String(error));
    });
  }, [t]);

  const confirmCommand = useCallback((command: PostureCommand) => {
    Alert.alert(
      t(`posture.${command}ConfirmTitle` as TranslationKey),
      t(`posture.${command}ConfirmMessage` as TranslationKey),
      [
        { text: t('posture.cancel'), style: 'cancel' },
        {
          text: t(`posture.${command}Button` as TranslationKey),
          onPress: () => sendCommand(command),
        },
      ],
    );
  }, [sendCommand, t]);

  const disabled = status !== 'connected' || !transport || url?.startsWith('demo://') || pending !== null;

  return (
    <View style={styles.container}>
      <PostureButton
        compact={compact}
        disabled={disabled}
        waiting={pending === 'stand'}
        icon="arrow-up-circle-outline"
        label={t('posture.standButton')}
        onPress={() => confirmCommand('stand')}
      />
      <PostureButton
        compact={compact}
        disabled={disabled}
        waiting={pending === 'lieDown'}
        icon="arrow-down-circle-outline"
        label={t('posture.lieDownButton')}
        onPress={() => confirmCommand('lieDown')}
      />
    </View>
  );
}

function PostureButton({ compact, disabled, waiting, icon, label, onPress }: {
  compact: boolean;
  disabled: boolean;
  waiting: boolean;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[styles.button, compact && styles.compactButton, disabled && styles.disabled]}
      disabled={disabled}
      onPress={onPress}
      activeOpacity={0.75}
    >
      <Ionicons
        name={waiting ? 'hourglass-outline' : icon}
        size={compact ? 20 : 16}
        color={disabled ? theme.colors.textMuted : theme.colors.statusConnected}
      />
      {!compact && <Text style={styles.text}>{label}</Text>}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    gap: 8,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.statusConnected + '66',
    backgroundColor: theme.colors.statusConnected + '11',
  },
  compactButton: {
    width: 40,
    height: 40,
    minHeight: 40,
    paddingHorizontal: 0,
  },
  disabled: {
    opacity: 0.45,
    borderColor: theme.colors.borderDefault,
    backgroundColor: theme.colors.bgSurface,
  },
  text: {
    fontSize: 13,
    fontWeight: '600',
    color: theme.colors.statusConnected,
  },
});
