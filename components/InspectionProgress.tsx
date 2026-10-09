import React from 'react';
import { Text, StyleSheet } from 'react-native';
import { useMissionStore } from '../stores/useMissionStore';
import { useAutonomyRuntimeStore } from '../stores/useAutonomyRuntimeStore';

const STAGES: Record<string, string> = {
  'Loading map / preparing ICP': '加载地图／准备 ICP',
  'ICP relocalizing': 'ICP 重定位中',
  'ICP succeeded; waiting for fresh pose': 'ICP 已成功，等待有效位姿',
  'Preparing localization and Planner': '准备定位和规划器',
  'waiting for owned Planner cmd_vel publisher': '启动 Planner，等待速度接口',
  'waiting for TF manager readiness': '等待机身坐标变换就绪',
  'waiting for FollowRoute action server': '等待 Planner 路线接口',
  'Acquiring control authority': '获取巡检控制权',
  'Waiting for LOCO acknowledgement': '等待行走模式就绪',
  'Submitting global route; waiting for Planner acceptance': '提交全局路线，等待 Planner 接收',
};

/** Stage text is supplied by the robot; no timer-based simulated progress. */
export function InspectionProgress({ zh }: { zh: boolean }) {
  const mission = useMissionStore((s) => s.status);
  const stale = useMissionStore((s) => s.missionStatusStale);
  const runtime = useAutonomyRuntimeStore((s) => s.status);
  if (!mission || mission.state === 0 || mission.state === 4 || mission.state === 5) return null;
  const failed = mission.state === 6 || mission.state === 7;
  const text = stale ? (zh ? '巡检状态未更新' : 'Mission status stale')
    : failed ? mission.reason_text || mission.status_text
    : mission.state === 1 && runtime && [1, 3, 4].includes(runtime.phase)
      ? runtime.reason_text || mission.status_text
      : mission.status_text;
  if (!text) return null;
  return <Text accessibilityLiveRegion="polite" numberOfLines={3}
    style={[styles.text, (failed || stale) && styles.error]}>{zh ? STAGES[text] || text : text}</Text>;
}
const styles = StyleSheet.create({
  text: { color: '#E7F0F1', fontSize: 11, maxWidth: 225, textAlign: 'center', padding: 4,
    borderRadius: 6, backgroundColor: '#071116B0' },
  error: { color: '#FF8D83' },
});
