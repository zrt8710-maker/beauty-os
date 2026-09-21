import "server-only";

import type { RecentSkinTrend } from "@/domain/recent-skin-trend";
import {
  DAILY_STATE_CONCERN_KINDS,
  type SkinCheckin,
  type DailyStateArea,
  type DailyStateConcernKind,
} from "@/schemas/checkin";
import type { SkinCheckinRepository } from "@/server/repositories/skin-checkin-repository";
import { createSkinCheckinService } from "@/server/services/skin-checkin-service";
import { createSkinTrendEvidenceService } from "@/server/services/skin-trend-evidence-service";

const concernLabels: Record<DailyStateConcernKind, string> = {
  oiliness: "出油",
  dryness: "干燥",
  flaking: "起皮",
  roughness: "粗糙",
  redness: "泛红",
  stinging: "刺痛",
  itching: "发痒",
  burning: "灼热",
  blemishes: "痘痘",
  small_bumps: "小凸起",
  blackheads: "黑头",
  visible_pores: "毛孔明显",
  uneven_tone: "肤色不均",
  dullness: "暗沉",
  post_blemish_marks: "痘印或残留印记",
};

const areaLabels: Record<DailyStateArea, string> = {
  t_zone: "T区",
  forehead: "额头",
  hairline: "发际线",
  nose: "鼻子",
  nose_wings: "鼻翼",
  cheeks: "脸颊",
  chin: "下巴",
  eye_area: "眼周",
  full_face: "全脸",
  other: "局部",
};

/** Read-only profile query boundary. It never receives Profile facts or calls a provider. */
export function createRecentSkinTrendsService(checkins: SkinCheckinRepository) {
  const skinCheckins = createSkinCheckinService(checkins);
  const evidence = createSkinTrendEvidenceService();

  return {
    async listForUser(userId: string, endDate: string): Promise<RecentSkinTrend[]> {
      const records = await skinCheckins.listCheckins(userId, { limit: 30 });
      return buildRecentSkinTrends(records, endDate, evidence);
    },
  };
}

export function buildRecentSkinTrends(
  records: SkinCheckin[],
  endDate: string,
  evidence = createSkinTrendEvidenceService(),
): RecentSkinTrend[] {
  return DAILY_STATE_CONCERN_KINDS.flatMap((concern) => {
    const result = evidence.evaluate({
      checkins: records,
      concern,
      end_date: endDate,
    });

    return result.statements_allowed.includes("recent_multiple_records")
      ? [toRecentSkinTrend(result)]
      : [];
  });
}

function toRecentSkinTrend(
  result: ReturnType<
    ReturnType<typeof createSkinTrendEvidenceService>["evaluate"]
  >,
): RecentSkinTrend {
  const label = concernLabels[result.concern.kind];
  const area = result.recurring_areas.find((item) => item.present_days >= 2);
  const areaText = area ? areaLabels[area.area] : null;
  const trigger = result.recurring_triggers.find((item) => item.present_days >= 2);
  return {
    title: areaText ? `${areaText}${label}近期反复出现` : `${label}近期反复出现`,
    supporting_line: `过去28天的${result.window.confirmed_checkin_days}次皮肤记录中，有${result.concern.present_days.length}次记录到${areaText ?? ""}${label}。`,
    ...(trigger ? { detail: `其中多次记录为：${trigger.trigger}` } : {}),
  };
}
