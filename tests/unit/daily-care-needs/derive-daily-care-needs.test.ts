import { describe, expect, it } from "vitest";

import {
  deriveDailyCareNeeds,
  type DailyCareNeedsInput,
} from "@/server/domain/daily-care-needs";

describe("deriveDailyCareNeeds", () => {
  it("uses high profile sensitivity when today's check-in is missing", () => {
    const result = deriveDailyCareNeeds(input({
      profile: profile({ sensitivityLevel: 4 }),
      checkin: null,
    }));

    expect(priorityCodes(result)).toEqual([
      "barrier_support",
      "soothing",
    ]);
    expect(restrictionCodes(result)).toContain("REDUCE_TREATMENT");
    expect(reason(result, "LONG_TERM_SENSITIVITY_HIGH")?.source).toBe(
      "profile",
    );
    expect(unknownCodes(result)).toContain("CHECKIN_MISSING");
  });

  it("adds soothing and a gentle-routine restriction for high redness", () => {
    const result = deriveDailyCareNeeds(input({
      checkin: checkin({ rednessLevel: 3 }),
    }));

    expect(priorityCodes(result)).toContain("soothing");
    expect(restrictionCodes(result)).toContain("PREFER_GENTLE_ROUTINE");
    expect(reason(result, "TODAY_REDNESS_HIGH")).toMatchObject({
      source: "checkin",
    });
  });

  it("keeps hydration and oil balance together for dry and oily skin", () => {
    const result = deriveDailyCareNeeds(input({
      checkin: checkin({ drynessLevel: 3, oilinessLevel: 4 }),
    }));

    expect(priorityCodes(result)).toEqual([
      "hydration",
      "barrier_support",
      "oil_balance",
    ]);
  });

  it("reports missing weather without assuming a zero UV index", () => {
    const result = deriveDailyCareNeeds(input({ weather: null }));

    expect(unknownCodes(result)).toContain("WEATHER_MISSING");
    expect(priorityCodes(result)).not.toContain("sun_protection");
  });

  it("adds sun protection for high UV in the morning", () => {
    const result = deriveDailyCareNeeds(input({
      period: "am",
      weather: weather({ uvIndex: 6 }),
    }));

    expect(priorityCodes(result)).toContain("sun_protection");
    expect(result.requiredRoles).toContain("sunscreen");
    expect(reason(result, "HIGH_UV_AM")?.source).toBe("weather");
  });

  it("does not apply the morning high-UV rule at night", () => {
    const result = deriveDailyCareNeeds(input({
      period: "pm",
      weather: weather({ uvIndex: 9 }),
    }));

    expect(priorityCodes(result)).not.toContain("sun_protection");
    expect(result.requiredRoles).toEqual(["cleanser", "moisturizer"]);
  });

  it("distinguishes a missing check-in from explicit zero levels", () => {
    const missing = deriveDailyCareNeeds(input({ checkin: null }));
    const explicitZero = deriveDailyCareNeeds(input({
      checkin: checkin(),
    }));

    expect(unknownCodes(missing)).toContain("CHECKIN_MISSING");
    expect(unknownCodes(explicitZero)).not.toContain("CHECKIN_MISSING");
    expect(priorityCodes(explicitZero)).toEqual([]);
  });

  it("uses the higher of long-term and daily sensitivity", () => {
    const result = deriveDailyCareNeeds(input({
      profile: profile({ sensitivityLevel: 1 }),
      checkin: checkin({ sensitivityLevel: 3 }),
    }));

    expect(priorityCodes(result)).toEqual([
      "barrier_support",
      "soothing",
    ]);
    expect(restrictionCodes(result)).toContain("REDUCE_TREATMENT");
    expect(reason(result, "TODAY_SENSITIVITY_HIGH")?.source).toBe("checkin");
  });

  it("ignores an unknown check-in field rather than treating its stored zero as explicit", () => {
    const result = deriveDailyCareNeeds(input({
      checkin: { drynessLevel: undefined, oilinessLevel: undefined, sensitivityLevel: undefined, rednessLevel: undefined, acneLevel: undefined },
    }));
    expect(priorityCodes(result)).toEqual([]);
    expect(restrictionCodes(result)).not.toContain("REDUCE_TREATMENT");
  });

  it("returns equal values for equal inputs without mutating the input", () => {
    const value = input({
      checkin: checkin({ drynessLevel: 3, rednessLevel: 3 }),
      weather: weather({ uvIndex: 8 }),
    });
    const before = structuredClone(value);

    expect(deriveDailyCareNeeds(value)).toEqual(deriveDailyCareNeeds(value));
    expect(value).toEqual(before);
  });
});

function input(
  override: Partial<DailyCareNeedsInput> = {},
): DailyCareNeedsInput {
  return {
    routineDate: "2026-08-19",
    period: "am",
    profile: profile(),
    checkin: checkin(),
    weather: weather(),
    history: {
      recentHighReactionCount: 0,
      repeatedDrynessDays: 0,
      repeatedRednessDays: 0,
    },
    ...override,
  };
}

function profile(
  override: Partial<NonNullable<DailyCareNeedsInput["profile"]>> = {},
): NonNullable<DailyCareNeedsInput["profile"]> {
  return {
    skinType: "combination",
    sensitivityLevel: 0,
    goals: [],
    avoidIngredients: [],
    maxSteps: 4,
    ...override,
  };
}

function checkin(
  override: Partial<NonNullable<DailyCareNeedsInput["checkin"]>> = {},
): NonNullable<DailyCareNeedsInput["checkin"]> {
  return {
    drynessLevel: 0,
    oilinessLevel: 0,
    sensitivityLevel: 0,
    rednessLevel: 0,
    acneLevel: 0,
    ...override,
  };
}

function weather(
  override: Partial<NonNullable<DailyCareNeedsInput["weather"]>> = {},
): NonNullable<DailyCareNeedsInput["weather"]> {
  return {
    temperature: 24,
    humidity: 55,
    uvIndex: 3,
    ...override,
  };
}

function priorityCodes(
  result: ReturnType<typeof deriveDailyCareNeeds>,
) {
  return result.priorities.map((priority) => priority.code);
}

function restrictionCodes(
  result: ReturnType<typeof deriveDailyCareNeeds>,
) {
  return result.restrictions.map((restriction) => restriction.code);
}

function unknownCodes(result: ReturnType<typeof deriveDailyCareNeeds>) {
  return result.unknowns.map((unknown) => unknown.code);
}

function reason(
  result: ReturnType<typeof deriveDailyCareNeeds>,
  code: string,
) {
  return result.reasons.find((item) => item.code === code);
}
